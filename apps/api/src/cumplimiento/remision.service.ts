import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { fiscalTransmissionQueue } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, optionalUuid, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { proximoIntento as calcularProximoIntento } from './backoff';
import { type RemisionAdapter, REMISION_ADAPTER } from './remision-adapter';

export type FilaRemision = typeof fiscalTransmissionQueue.$inferSelect;

export interface EntradaEncolar {
  companyId: string;
  documentId?: string | null;
  fiscalEventId?: string | null;
  payload: unknown;
}

export interface ResumenProceso {
  procesados: number;
  acusados: number;
  reintentables: number;
  errores: number;
}

/**
 * Cola de remisión de registros de facturación al SENIAT (P17, Providencia 121 §6.3 req. 2). Cada
 * documento emitido se encola (`encolar`) en la misma transacción de emisión: remisión **automática**.
 * `procesarPendientes` intenta enviar los ítems elegibles vía el adapter (hoy stub) con **reintentos y
 * backoff exponencial**, y registra el **acuse** cuando el SENIAT lo confirma (fehaciencia). Módulo
 * desacoplado: al publicarse el canal real solo cambia el adapter inyectado (`REMISION_ADAPTER`).
 */
@Injectable()
export class RemisionService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REMISION_ADAPTER) private readonly adapter: RemisionAdapter,
  ) {}

  /** Encola un registro de facturación para remisión, dentro de la transacción `tx` en curso. */
  async encolar(tx: DatabaseTx, entrada: EntradaEncolar): Promise<FilaRemision> {
    const ctx = requireTenantContext();
    const [fila] = await tx
      .insert(fiscalTransmissionQueue)
      .values({
        tenantId: ctx.tenantId,
        companyId: entrada.companyId,
        documentId: entrada.documentId ?? null,
        fiscalEventId: entrada.fiscalEventId ?? null,
        payload: (entrada.payload ?? {}) as object,
        estado: 'PENDIENTE',
      })
      .returning();
    if (fila === undefined) throw new Error('No se pudo encolar la remisión');
    return fila;
  }

  /**
   * Procesa los ítems elegibles del tenant en contexto (PENDIENTE con `proximo_intento` vencido).
   * `FOR UPDATE SKIP LOCKED` evita que dos procesadores tomen el mismo ítem. Cada intento:
   * ACUSADO → cerrado con acuse; REINTENTABLE → backoff (o ERROR si se agotan los reintentos);
   * PERMANENTE → ERROR inmediato.
   */
  async procesarPendientes(limiteRaw?: unknown): Promise<ResumenProceso> {
    const limite = optionalInt(limiteRaw, 'limite', 50, 1);
    return withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      const pendientes = await tx
        .select()
        .from(fiscalTransmissionQueue)
        .where(and(eq(fiscalTransmissionQueue.estado, 'PENDIENTE'), lte(fiscalTransmissionQueue.proximoIntento, ahora)))
        .orderBy(asc(fiscalTransmissionQueue.proximoIntento))
        .limit(limite)
        .for('update', { skipLocked: true });

      const resumen: ResumenProceso = { procesados: 0, acusados: 0, reintentables: 0, errores: 0 };
      for (const item of pendientes) {
        resumen.procesados += 1;
        const resultado = await this.adapter.transmitir(item.payload);
        if (resultado.tipo === 'ACUSADO') {
          await tx
            .update(fiscalTransmissionQueue)
            .set({
              estado: 'ACUSADO',
              acuse: resultado.acuse as object,
              acuseRef: resultado.acuseRef,
              ultimoError: null,
              enviadoAt: ahora,
              acusadoAt: ahora,
              updatedAt: ahora,
            })
            .where(eq(fiscalTransmissionQueue.id, item.id));
          resumen.acusados += 1;
        } else if (resultado.tipo === 'PERMANENTE') {
          await tx
            .update(fiscalTransmissionQueue)
            .set({ estado: 'ERROR', ultimoError: resultado.motivo, updatedAt: ahora })
            .where(eq(fiscalTransmissionQueue.id, item.id));
          resumen.errores += 1;
        } else {
          // REINTENTABLE: avanza el contador; si se agotan los reintentos, queda en ERROR.
          const reintentos = item.reintentos + 1;
          if (reintentos >= item.maxReintentos) {
            await tx
              .update(fiscalTransmissionQueue)
              .set({ estado: 'ERROR', reintentos: item.maxReintentos, ultimoError: resultado.motivo, updatedAt: ahora })
              .where(eq(fiscalTransmissionQueue.id, item.id));
            resumen.errores += 1;
          } else {
            await tx
              .update(fiscalTransmissionQueue)
              .set({
                reintentos,
                ultimoError: resultado.motivo,
                proximoIntento: calcularProximoIntento(reintentos, ahora),
                updatedAt: ahora,
              })
              .where(eq(fiscalTransmissionQueue.id, item.id));
            resumen.reintentables += 1;
          }
        }
      }
      return resumen;
    });
  }

  /** Reabre un ítem en ERROR para reintentarlo de inmediato (acción de gestión). */
  async reintentar(body: unknown): Promise<FilaRemision> {
    const id = requireUuid(asRecord(body).id, 'id');
    return withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      const [previa] = await tx.select().from(fiscalTransmissionQueue).where(eq(fiscalTransmissionQueue.id, id)).limit(1);
      if (previa === undefined) throw new NotFoundException(`Remisión ${id} no encontrada en el tenant actual`);
      if (previa.estado === 'ACUSADO') throw new BadRequestException('La remisión ya fue acusada; no se reintenta');

      const [fila] = await tx
        .update(fiscalTransmissionQueue)
        .set({ estado: 'PENDIENTE', reintentos: 0, ultimoError: null, proximoIntento: ahora, updatedAt: ahora })
        .where(eq(fiscalTransmissionQueue.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo reabrir la remisión');
      return fila;
    });
  }

  /** Lista la cola de remisión (filtros opcionales `companyId`, `estado`). */
  async listar(query: Record<string, unknown>): Promise<FilaRemision[]> {
    const companyId = optionalUuid(query.companyId, 'companyId');
    const estado =
      query.estado === undefined || query.estado === null || String(query.estado).trim() === ''
        ? null
        : String(query.estado).toUpperCase();
    if (estado !== null && !['PENDIENTE', 'ENVIADO', 'ACUSADO', 'ERROR'].includes(estado)) {
      throw new BadRequestException(`estado inválido: ${estado}`);
    }
    return withTenant(this.database.db, async (tx) => {
      if (companyId !== null) await asegurarEmpresaDelTenant(tx, companyId);
      const filtros = [
        ...(companyId !== null ? [eq(fiscalTransmissionQueue.companyId, companyId)] : []),
        ...(estado !== null ? [eq(fiscalTransmissionQueue.estado, estado)] : []),
      ];
      const where = filtros.length > 0 ? and(...filtros) : undefined;
      return tx.select().from(fiscalTransmissionQueue).where(where).orderBy(desc(fiscalTransmissionQueue.createdAt));
    });
  }
}
