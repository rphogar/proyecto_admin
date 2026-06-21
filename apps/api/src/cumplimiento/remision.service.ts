import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { fiscalTransmissionQueue } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, optionalUuid, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { proximoIntento as calcularProximoIntento } from './backoff';
import { type ConteosCola, type EstadoCola, evaluarAlertas, tasaError } from './observabilidad';
import { generarIdempotencyKey, type RegistroParaRemision, type RemisionAdapter, REMISION_ADAPTER } from './remision-adapter';

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
  enviados: number;
  reintentables: number;
  errores: number;
}

/** Estados elegibles para el procesador: PENDIENTE (por enviar) y ENVIADO (por consultar acuse). */
const ESTADOS_ELEGIBLES = ['PENDIENTE', 'ENVIADO'] as const;

/**
 * Cola de remisión de registros de facturación al SENIAT (P17/P25, Providencia 121 §6.3 req. 2). Cada
 * documento emitido se encola (`encolar`) en la misma transacción de emisión: remisión **automática**
 * e **idempotente** (un documento no se encola dos veces). `procesarPendientes` intenta enviar los
 * ítems elegibles vía el adapter (hoy stub) con **reintentos y backoff exponencial**; soporta canal
 * síncrono (ACUSADO inmediato) y asíncrono (ENVIADO + `consultarAcuse`), y registra el **acuse**
 * (fehaciencia). `estadoCola` expone observabilidad (conteos, antigüedad del pendiente más viejo, tasa
 * de error, alertas). Módulo desacoplado: al publicarse el canal real solo cambia `REMISION_ADAPTER`.
 */
@Injectable()
export class RemisionService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REMISION_ADAPTER) private readonly adapter: RemisionAdapter,
  ) {}

  /**
   * Encola un registro de facturación para remisión, dentro de la transacción `tx` en curso.
   * **Idempotente por documento**: si el documento ya está encolado, devuelve la fila existente sin
   * crear un duplicado (índice único `(tenant_id, idempotency_key)`). El `idempotency_key` viaja al
   * canal del SENIAT como token de deduplicación.
   */
  async encolar(tx: DatabaseTx, entrada: EntradaEncolar): Promise<FilaRemision> {
    const ctx = requireTenantContext();
    const documentId = entrada.documentId ?? null;
    // Clave de idempotencia estable por documento; UUID propio para remisiones sin documento.
    const idempotencyKey = documentId ?? generarIdempotencyKey();

    const [fila] = await tx
      .insert(fiscalTransmissionQueue)
      .values({
        tenantId: ctx.tenantId,
        companyId: entrada.companyId,
        documentId,
        fiscalEventId: entrada.fiscalEventId ?? null,
        idempotencyKey,
        payload: (entrada.payload ?? {}) as object,
        estado: 'PENDIENTE',
      })
      .onConflictDoNothing({ target: [fiscalTransmissionQueue.tenantId, fiscalTransmissionQueue.idempotencyKey] })
      .returning();

    if (fila !== undefined) return fila;

    // Conflicto: ya existe una remisión con este idempotency_key (mismo documento) → devolverla.
    const [existente] = await tx
      .select()
      .from(fiscalTransmissionQueue)
      .where(and(eq(fiscalTransmissionQueue.tenantId, ctx.tenantId), eq(fiscalTransmissionQueue.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (existente === undefined) throw new Error('No se pudo encolar la remisión');
    return existente;
  }

  /**
   * Procesa los ítems elegibles del tenant en contexto (PENDIENTE/ENVIADO con `proximo_intento`
   * vencido). `FOR UPDATE SKIP LOCKED` evita que dos procesadores tomen el mismo ítem. Cada PENDIENTE
   * se envía (`transmitir`); cada ENVIADO consulta su acuse (`consultarAcuse`). Desenlaces:
   * ACUSADO → cerrado con constancia; ENVIADO → a la espera de acuse asíncrono; REINTENTABLE/PENDIENTE
   * → backoff (o ERROR si se agotan los reintentos); PERMANENTE → ERROR inmediato.
   */
  async procesarPendientes(limiteRaw?: unknown): Promise<ResumenProceso> {
    const limite = optionalInt(limiteRaw, 'limite', 50, 1);
    return withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      const pendientes = await tx
        .select()
        .from(fiscalTransmissionQueue)
        .where(and(inArray(fiscalTransmissionQueue.estado, [...ESTADOS_ELEGIBLES]), lte(fiscalTransmissionQueue.proximoIntento, ahora)))
        .orderBy(asc(fiscalTransmissionQueue.proximoIntento))
        .limit(limite)
        .for('update', { skipLocked: true });

      const resumen: ResumenProceso = { procesados: 0, acusados: 0, enviados: 0, reintentables: 0, errores: 0 };
      for (const item of pendientes) {
        resumen.procesados += 1;
        if (item.estado === 'ENVIADO') {
          await this.procesarAcuse(tx, item, ahora, resumen);
        } else {
          await this.procesarEnvio(tx, item, ahora, resumen);
        }
      }
      return resumen;
    });
  }

  /** Primer tramo: envío de un ítem PENDIENTE. */
  private async procesarEnvio(tx: DatabaseTx, item: FilaRemision, ahora: Date, resumen: ResumenProceso): Promise<void> {
    const resultado = await this.adapter.transmitir(this.registro(item));
    if (resultado.tipo === 'ACUSADO') {
      await this.marcarAcusado(tx, item.id, resultado.acuseRef, resultado.acuse, ahora);
      resumen.acusados += 1;
    } else if (resultado.tipo === 'ENVIADO') {
      // Aceptado por el canal; el acuse llega de forma asíncrona → se consultará en el próximo ciclo.
      await tx
        .update(fiscalTransmissionQueue)
        .set({ estado: 'ENVIADO', refEnvio: resultado.refEnvio, ultimoError: null, enviadoAt: ahora, proximoIntento: calcularProximoIntento(0, ahora), updatedAt: ahora })
        .where(eq(fiscalTransmissionQueue.id, item.id));
      resumen.enviados += 1;
    } else if (resultado.tipo === 'PERMANENTE') {
      await this.marcarError(tx, item.id, resultado.motivo, item.reintentos, ahora);
      resumen.errores += 1;
    } else {
      // REINTENTABLE: avanza el contador; si se agotan los reintentos, queda en ERROR.
      await this.reintentarOError(tx, item, resultado.motivo, ahora, resumen);
    }
  }

  /** Segundo tramo: consulta del acuse de un ítem ENVIADO (canal asíncrono). */
  private async procesarAcuse(tx: DatabaseTx, item: FilaRemision, ahora: Date, resumen: ResumenProceso): Promise<void> {
    if (this.adapter.consultarAcuse === undefined || item.refEnvio === null) {
      // Canal síncrono sin consulta de acuse: no debería haber ENVIADO; se deja para diagnóstico.
      await this.marcarError(tx, item.id, 'Ítem ENVIADO sin canal de consulta de acuse disponible', item.reintentos, ahora);
      resumen.errores += 1;
      return;
    }
    const resultado = await this.adapter.consultarAcuse(item.refEnvio, this.registro(item));
    if (resultado.tipo === 'ACUSADO') {
      await this.marcarAcusado(tx, item.id, resultado.acuseRef, resultado.acuse, ahora);
      resumen.acusados += 1;
    } else if (resultado.tipo === 'PERMANENTE') {
      await this.marcarError(tx, item.id, resultado.motivo, item.reintentos, ahora);
      resumen.errores += 1;
    } else {
      // PENDIENTE: el acuse aún no llega. Reintenta la consulta con backoff; agota como ERROR.
      await this.reintentarOError(tx, item, resultado.motivo ?? 'Acuse aún no disponible', ahora, resumen);
    }
  }

  /** Avanza el contador de reintentos; si se agotan, marca ERROR; si no, reagenda con backoff. */
  private async reintentarOError(tx: DatabaseTx, item: FilaRemision, motivo: string, ahora: Date, resumen: ResumenProceso): Promise<void> {
    const reintentos = item.reintentos + 1;
    if (reintentos >= item.maxReintentos) {
      await this.marcarError(tx, item.id, motivo, item.maxReintentos, ahora);
      resumen.errores += 1;
    } else {
      await tx
        .update(fiscalTransmissionQueue)
        .set({ reintentos, ultimoError: motivo, proximoIntento: calcularProximoIntento(reintentos, ahora), updatedAt: ahora })
        .where(eq(fiscalTransmissionQueue.id, item.id));
      resumen.reintentables += 1;
    }
  }

  private async marcarAcusado(tx: DatabaseTx, id: string, acuseRef: string, acuse: unknown, ahora: Date): Promise<void> {
    await tx
      .update(fiscalTransmissionQueue)
      .set({ estado: 'ACUSADO', acuse: acuse as object, acuseRef, ultimoError: null, enviadoAt: ahora, acusadoAt: ahora, updatedAt: ahora })
      .where(eq(fiscalTransmissionQueue.id, id));
  }

  private async marcarError(tx: DatabaseTx, id: string, motivo: string, reintentos: number, ahora: Date): Promise<void> {
    await tx
      .update(fiscalTransmissionQueue)
      .set({ estado: 'ERROR', reintentos, ultimoError: motivo, updatedAt: ahora })
      .where(eq(fiscalTransmissionQueue.id, id));
  }

  /** Arma el contexto que la cola entrega al adapter (no expone columnas internas de la fila). */
  private registro(item: FilaRemision): RegistroParaRemision {
    return { idempotencyKey: item.idempotencyKey, documentId: item.documentId, payload: item.payload, intento: item.reintentos };
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
        .set({ estado: 'PENDIENTE', reintentos: 0, refEnvio: null, ultimoError: null, proximoIntento: ahora, updatedAt: ahora })
        .where(eq(fiscalTransmissionQueue.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo reabrir la remisión');
      return fila;
    });
  }

  /** Lista la cola de remisión (filtros opcionales `companyId`, `estado`). */
  async listar(query: Record<string, unknown>): Promise<FilaRemision[]> {
    const companyId = optionalUuid(query.companyId, 'companyId');
    const estado = this.estadoFiltro(query.estado);
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

  /**
   * Observabilidad de la cola (P25): conteos por estado, backlog elegible, antigüedad del registro
   * sin acusar más viejo, tasa de error y alertas operativas. Tenant-scoped (RLS); filtro opcional por
   * empresa. La UI/alarmas lo consumen para vigilar que la remisión sea "continua e inmediata".
   */
  async estadoCola(query: Record<string, unknown>): Promise<EstadoCola> {
    const companyId = optionalUuid(query?.companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      if (companyId !== null) await asegurarEmpresaDelTenant(tx, companyId);
      const filtroEmpresa = companyId !== null ? eq(fiscalTransmissionQueue.companyId, companyId) : undefined;
      const ahora = new Date();

      const filas = await tx
        .select({
          estado: fiscalTransmissionQueue.estado,
          n: sql<number>`count(*)::int`,
          masViejo: sql<string | null>`min(${fiscalTransmissionQueue.createdAt})`,
        })
        .from(fiscalTransmissionQueue)
        .where(filtroEmpresa)
        .groupBy(fiscalTransmissionQueue.estado);

      const acc = { pendiente: 0, enviado: 0, acusado: 0, error: 0, total: 0 };
      let masViejoSinAcusar: number | null = null;
      for (const f of filas) {
        const n = Number(f.n);
        acc.total += n;
        if (f.estado === 'PENDIENTE') acc.pendiente = n;
        else if (f.estado === 'ENVIADO') acc.enviado = n;
        else if (f.estado === 'ACUSADO') acc.acusado = n;
        else if (f.estado === 'ERROR') acc.error = n;
        // Antigüedad: solo cuenta lo que aún no se acusó (PENDIENTE/ENVIADO).
        if ((f.estado === 'PENDIENTE' || f.estado === 'ENVIADO') && f.masViejo !== null) {
          masViejoSinAcusar = Math.min(masViejoSinAcusar ?? Infinity, new Date(f.masViejo).getTime());
        }
      }
      const conteos: ConteosCola = acc;

      const [{ elegibles } = { elegibles: 0 }] = await tx
        .select({ elegibles: sql<number>`count(*)::int` })
        .from(fiscalTransmissionQueue)
        .where(
          and(
            inArray(fiscalTransmissionQueue.estado, [...ESTADOS_ELEGIBLES]),
            lte(fiscalTransmissionQueue.proximoIntento, ahora),
            ...(filtroEmpresa !== undefined ? [filtroEmpresa] : []),
          ),
        );

      const antiguedadPendienteSegundos =
        masViejoSinAcusar === null ? null : Math.max(0, Math.floor((ahora.getTime() - masViejoSinAcusar) / 1000));
      const base = {
        conteos,
        pendientesElegibles: Number(elegibles),
        antiguedadPendienteSegundos,
        tasaError: tasaError(conteos.acusado, conteos.error),
      };
      return { ...base, alertas: evaluarAlertas(base) };
    });
  }

  private estadoFiltro(raw: unknown): string | null {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const estado = String(raw).toUpperCase();
    if (!['PENDIENTE', 'ENVIADO', 'ACUSADO', 'ERROR'].includes(estado)) {
      throw new BadRequestException(`estado inválido: ${estado}`);
    }
    return estado;
  }
}
