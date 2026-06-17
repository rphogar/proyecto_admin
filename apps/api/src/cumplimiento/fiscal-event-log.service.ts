import { Injectable } from '@nestjs/common';
import { instanteCaracasISO } from '@contave/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { fiscalEventLog } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, optionalUuid, requireEnum, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularEventHash, type EslabonCadena, type ResultadoVerificacion, verificarCadena } from './cadena-hash';

export type TipoEventoFiscal =
  | 'EMISION'
  | 'IMPRESION'
  | 'REIMPRESION'
  | 'NOTA_CREDITO'
  | 'NOTA_DEBITO'
  | 'ANULACION'
  | 'FALLO';

const TIPOS_EVENTO = ['EMISION', 'IMPRESION', 'REIMPRESION', 'NOTA_CREDITO', 'NOTA_DEBITO', 'ANULACION', 'FALLO'] as const;
/** Eventos que un usuario puede registrar manualmente por endpoint (el resto los emite el sistema). */
const TIPOS_MANUALES: ReadonlySet<TipoEventoFiscal> = new Set(['IMPRESION', 'REIMPRESION', 'ANULACION', 'FALLO']);

export interface EventoFiscal {
  companyId: string;
  documentId?: string | null;
  eventType: TipoEventoFiscal;
  tipoDocumento?: string | null;
  documentNumber?: string | null;
  controlNumber?: string | null;
  hashDocumento?: string | null;
  payload: unknown;
}

export type FilaEventoFiscal = typeof fiscalEventLog.$inferSelect;

/**
 * Bitácora fiscal integral (P17, Providencia 121 §6.3 req. 1 y 3). Registra todo evento relevante de
 * un documento fiscal (emisión, impresión, reimpresión, NC/ND, anulación, fallos) de forma append-only
 * y **encadenada por hash** (cada evento incorpora el hash del anterior del tenant → inviolabilidad).
 *
 * `registrar` se invoca DENTRO de la transacción de la operación fiscal (atómico con la emisión); usa
 * un advisory lock por tenant para serializar el avance de la cadena bajo concurrencia (consecutiva).
 * `registrarManual` abre su propia transacción para eventos disparados por endpoint.
 */
@Injectable()
export class FiscalEventLogService {
  constructor(private readonly database: DatabaseService) {}

  /** Appendea un evento a la cadena del tenant dentro de la transacción `tx` en curso. */
  async registrar(tx: DatabaseTx, evento: EventoFiscal): Promise<FilaEventoFiscal> {
    const ctx = requireTenantContext();
    const ahora = new Date();

    // Serializa el avance de la cadena por tenant: el segundo emisor espera al COMMIT del primero y
    // así lee su hash como cabeza (sin esto, dos emisiones concurrentes bifurcarían la cadena).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ctx.tenantId}))`);

    const [cabeza] = await tx
      .select({ eventHash: fiscalEventLog.eventHash })
      .from(fiscalEventLog)
      .where(eq(fiscalEventLog.tenantId, ctx.tenantId))
      .orderBy(desc(fiscalEventLog.seq))
      .limit(1);
    const prevHash = cabeza?.eventHash ?? null;

    const documentId = evento.documentId ?? null;
    const tipoDocumento = evento.tipoDocumento ?? null;
    const documentNumber = evento.documentNumber ?? null;
    const controlNumber = evento.controlNumber ?? null;
    const hashDocumento = evento.hashDocumento ?? null;
    const tsUtc = ahora.toISOString();

    const eventHash = calcularEventHash({
      prevHash,
      tenantId: ctx.tenantId,
      companyId: evento.companyId,
      documentId,
      eventType: evento.eventType,
      documentNumber,
      controlNumber,
      hashDocumento,
      tsUtc,
      payload: evento.payload ?? null,
    });

    const [fila] = await tx
      .insert(fiscalEventLog)
      .values({
        tenantId: ctx.tenantId,
        companyId: evento.companyId,
        documentId,
        eventType: evento.eventType,
        tipoDocumento,
        documentNumber,
        controlNumber,
        hashDocumento,
        prevHash,
        eventHash,
        payload: (evento.payload ?? null) as object,
        actorUserId: ctx.userId ?? null,
        tsUtc: ahora,
        tsCaracas: instanteCaracasISO(ahora),
        ip: ctx.ip ?? null,
        device: ctx.device ?? null,
      })
      .returning();
    if (fila === undefined) throw new Error('No se pudo registrar el evento fiscal');
    return fila;
  }

  /** Registra un evento disparado por endpoint (impresión/reimpresión/anulación/fallo). */
  async registrarManual(body: unknown): Promise<FilaEventoFiscal> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const eventType = requireEnum(b.eventType, 'eventType', TIPOS_EVENTO, (s) => s.toUpperCase());
    if (!TIPOS_MANUALES.has(eventType)) {
      throw new Error(`El evento ${eventType} lo registra el sistema, no se admite manualmente`);
    }
    const evento: EventoFiscal = {
      companyId,
      documentId: optionalUuid(b.documentId, 'documentId'),
      eventType,
      tipoDocumento: optionalString(b.tipoDocumento, 'tipoDocumento', 40),
      documentNumber: optionalString(b.documentNumber, 'documentNumber', 40),
      controlNumber: optionalString(b.controlNumber, 'controlNumber', 40),
      hashDocumento: optionalString(b.hashDocumento, 'hashDocumento', 128),
      payload: b.payload ?? {},
    };
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return this.registrar(tx, evento);
    });
  }

  /** Lista los eventos de la bitácora (filtros opcionales `companyId`, `documentId`, `eventType`). */
  async listar(query: Record<string, unknown>): Promise<FilaEventoFiscal[]> {
    const companyId = optionalUuid(query.companyId, 'companyId');
    const documentId = optionalUuid(query.documentId, 'documentId');
    const eventType =
      query.eventType === undefined || query.eventType === null || String(query.eventType).trim() === ''
        ? null
        : requireEnum(query.eventType, 'eventType', TIPOS_EVENTO, (s) => s.toUpperCase());

    return withTenant(this.database.db, async (tx) => {
      const filtros = [
        ...(companyId !== null ? [eq(fiscalEventLog.companyId, companyId)] : []),
        ...(documentId !== null ? [eq(fiscalEventLog.documentId, documentId)] : []),
        ...(eventType !== null ? [eq(fiscalEventLog.eventType, eventType)] : []),
      ];
      const where = filtros.length > 0 ? and(...filtros) : undefined;
      return tx.select().from(fiscalEventLog).where(where).orderBy(asc(fiscalEventLog.seq));
    });
  }

  /**
   * Reverifica la integridad de la cadena COMPLETA del tenant (la cadena es por tenant, no por
   * empresa): comprueba el enlace `prev_hash` y que cada `event_hash` recompute (req. 1).
   */
  async verificarCadena(): Promise<ResultadoVerificacion> {
    return withTenant(this.database.db, async (tx) => {
      const filas = await tx.select().from(fiscalEventLog).orderBy(asc(fiscalEventLog.seq));
      const eslabones: EslabonCadena[] = filas.map((f) => ({
        prevHash: f.prevHash,
        tenantId: f.tenantId,
        companyId: f.companyId,
        documentId: f.documentId,
        eventType: f.eventType,
        documentNumber: f.documentNumber,
        controlNumber: f.controlNumber,
        hashDocumento: f.hashDocumento,
        tsUtc: f.tsUtc.toISOString(),
        payload: f.payload,
        eventHash: f.eventHash,
      }));
      return verificarCadena(eslabones);
    });
  }
}
