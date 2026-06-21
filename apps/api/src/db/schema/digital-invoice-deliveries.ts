import { type AnyPgColumn, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { fiscalEventLog } from './fiscal-event-log';
import { tenants } from './tenants';

/**
 * `digital_invoice_deliveries` — cola de **entrega y conservación** de la factura digital (P24,
 * Providencia SNAT/2024/000102; docs/05 §5, docs/13). Hermana de `fiscal_transmission_queue` (remisión)
 * y `fiscal_print_queue` (impresora fiscal), pero para el régimen digital: a diferencia de la máquina
 * fiscal, la emisión digital **sí consume el correlativo de la serie** (numeración por software,
 * consecutiva); la imprenta digital autorizada solo asigna el **número de control digital**.
 *
 * Tras emitir el documento (inmutable, ya con su número de control digital), se encola aquí su
 * **entrega electrónica** (correo u otro medio) y su **conservación** a disposición del SENIAT. Si el
 * proveedor está caído, el ítem queda PENDIENTE reintentándose con backoff (igual que la remisión), sin
 * afectar la emisión ya consumada.
 *
 * Mutable por diseño (transita de estado y acumula reintentos). Tenant-scoped → RLS. `document_id` ata
 * la entrega al documento emitido y `fiscal_event_id` al evento de bitácora de su emisión.
 */
export const digitalInvoiceDeliveries = pgTable('digital_invoice_deliveries', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Documento digital emitido cuya entrega/conservación se gestiona. */
  documentId: uuid('document_id')
    .notNull()
    .references((): AnyPgColumn => documents.id),
  /** Evento de bitácora de la emisión que origina la entrega (trazabilidad). */
  fiscalEventId: uuid('fiscal_event_id').references((): AnyPgColumn => fiscalEventLog.id),
  /** Número de control DIGITAL asignado por la imprenta autorizada (snapshot, = documents.control_number). */
  numeroControl: text('numero_control').notNull(),
  /** Identificador verificable del control digital (sello determinista; diagnóstico/verificación). */
  identificador: text('identificador').notNull(),
  /** Canal de entrega: EMAIL | OTRO (CHECK en 0065). */
  canal: text('canal').notNull(),
  /** Dirección de entrega (correo u otro identificador del canal). */
  destino: text('destino').notNull(),
  /** Snapshot a entregar/conservar: `{ documento: DocumentoDigital, destinatario }`. */
  payload: jsonb('payload').notNull(),
  /** Estado de la ENTREGA: PENDIENTE | ENTREGADO | ERROR (CHECK en 0065). */
  estado: text('estado').notNull().default('PENDIENTE'),
  /** Estado de la CONSERVACIÓN a disposición del SENIAT: PENDIENTE | CONSERVADO | ERROR (CHECK en 0065). */
  conservacionEstado: text('conservacion_estado').notNull().default('PENDIENTE'),
  /** Referencia de conservación devuelta por el proveedor (cuando CONSERVADO). */
  conservacionRef: text('conservacion_ref'),
  reintentos: integer('reintentos').notNull().default(0),
  maxReintentos: integer('max_reintentos').notNull().default(8),
  /** Próximo instante elegible para reintentar (backoff exponencial). */
  proximoIntento: timestamp('proximo_intento', { withTimezone: true }).defaultNow().notNull(),
  /** Último error reportado por el proveedor (diagnóstico). */
  ultimoError: text('ultimo_error'),
  /** Acuse de la entrega electrónica cuando ENTREGADO (fehaciencia). */
  entregaAcuse: jsonb('entrega_acuse'),
  entregadoAt: timestamp('entregado_at', { withTimezone: true }),
  conservadoAt: timestamp('conservado_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
