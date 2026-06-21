import { type AnyPgColumn, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { fiscalEventLog } from './fiscal-event-log';
import { tenants } from './tenants';

/**
 * `fiscal_transmission_queue` — cola de remisión de registros de facturación al SENIAT (P17,
 * docs/05 §3.9, Providencia 121 §6.3 req. 2: remisión electrónica "continua, segura, correcta,
 * íntegra, automática, consecutiva, inmediata y fehaciente").
 *
 * **Módulo desacoplado a propósito** (docs/05 §5, integración F3): el SENIAT aún no publica el canal
 * técnico, así que hoy el procesador usa un adapter *stub* (`StubRemisionAdapter`) que reporta el
 * canal como no disponible y los ítems quedan PENDIENTE. Cuando se publique la especificación, solo
 * se implementa el adapter real; la cola, los reintentos con backoff, el acuse, la idempotencia por
 * documento (`idempotency_key`) y la observabilidad ya están listos (P25).
 *
 * Mutable por diseño (la fila transita de estado y acumula reintentos), a diferencia del
 * `fiscal_event_log` (append-only). Tenant-scoped → RLS. El `fiscal_event_id` ata la remisión a su
 * evento de origen para trazabilidad punta a punta (req. 1).
 */
export const fiscalTransmissionQueue = pgTable('fiscal_transmission_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Evento de facturación que origina la remisión (trazabilidad). */
  fiscalEventId: uuid('fiscal_event_id').references((): AnyPgColumn => fiscalEventLog.id),
  documentId: uuid('document_id').references((): AnyPgColumn => documents.id),
  /** Carga a remitir (snapshot del registro de facturación). */
  payload: jsonb('payload').notNull(),
  /**
   * Token de idempotencia estable por documento (P25): único por tenant (índice en 0068). Viaja al
   * canal del SENIAT para que reintentos/reenvíos no dupliquen el registro. Igual al `document_id`
   * cuando la remisión nace de un documento; UUID propio en otro caso.
   */
  idempotencyKey: text('idempotency_key').notNull(),
  /** PENDIENTE | ENVIADO | ACUSADO | ERROR (CHECK en 0054). */
  estado: text('estado').notNull().default('PENDIENTE'),
  /** Intentos de remisión ya realizados. */
  reintentos: integer('reintentos').notNull().default(0),
  /** Tope de reintentos antes de marcar ERROR definitivo. */
  maxReintentos: integer('max_reintentos').notNull().default(8),
  /** Próximo instante elegible para reintentar (backoff exponencial). */
  proximoIntento: timestamp('proximo_intento', { withTimezone: true }).defaultNow().notNull(),
  /** Último error reportado por el adapter (diagnóstico). */
  ultimoError: text('ultimo_error'),
  /**
   * Referencia del envío en un canal **asíncrono** (P25): la devuelve `transmitir` al aceptar el
   * envío; con ella se consulta el acuse luego (`consultarAcuse`). Null en canales síncronos.
   */
  refEnvio: text('ref_envio'),
  /** Acuse de recibo del SENIAT cuando el estado es ACUSADO (fehaciencia, req. 2). */
  acuse: jsonb('acuse'),
  /** Referencia/constancia del acuse (número de recepción). */
  acuseRef: text('acuse_ref'),
  enviadoAt: timestamp('enviado_at', { withTimezone: true }),
  acusadoAt: timestamp('acusado_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
