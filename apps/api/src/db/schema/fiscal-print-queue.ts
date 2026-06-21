import { type AnyPgColumn, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { fiscalEventLog } from './fiscal-event-log';
import { tenants } from './tenants';

/**
 * `fiscal_print_queue` — cola de impresión hacia la máquina fiscal (P23, docs/05 §5). Espejo de
 * `fiscal_transmission_queue` pero para el hardware: **la API SaaS no habla con la impresora**; encola
 * el trabajo (con los comandos ya mapeados) y un **agente local** lo reclama, lo imprime por serie/USB
 * y reporta el resultado.
 *
 * Autoridad de numeración = la impresora (decisión P23, modelo real VE): el `numero_fiscal`/
 * `control_fiscal` los asigna la memoria fiscal y vuelven en el acuse; el documento del SaaS NO consume
 * correlativo de serie en este modo. Por eso `document_id` queda PENDIENTE de cierre hasta el acuse.
 *
 * **Contingencia:** si la impresora está caída, el job queda PENDIENTE reintentándose con backoff
 * (igual que la remisión), sin romper numeración ni atomicidad de la emisión.
 *
 * Mutable por diseño (transita de estado y acumula reintentos). Tenant-scoped → RLS. `fiscal_event_id`
 * ata el job a su evento de bitácora para trazabilidad punta a punta.
 */
export const fiscalPrintQueue = pgTable('fiscal_print_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Evento de bitácora que origina la impresión (trazabilidad). */
  fiscalEventId: uuid('fiscal_event_id').references((): AnyPgColumn => fiscalEventLog.id),
  /** Documento que se imprime (queda pendiente de cierre fiscal hasta el acuse de impresión). */
  documentId: uuid('document_id').references((): AnyPgColumn => documents.id),
  /** Snapshot a imprimir: `{ documento, comandos }` (comandos ya mapeados, agnósticos de marca). */
  payload: jsonb('payload').notNull(),
  /** PENDIENTE | RECLAMADO | IMPRESO | ERROR (CHECK en 0061). */
  estado: text('estado').notNull().default('PENDIENTE'),
  /** Identidad del agente local que reclamó el job (diagnóstico / multi-caja). */
  agenteId: text('agente_id'),
  reintentos: integer('reintentos').notNull().default(0),
  maxReintentos: integer('max_reintentos').notNull().default(8),
  /** Próximo instante elegible para reintentar (backoff exponencial). */
  proximoIntento: timestamp('proximo_intento', { withTimezone: true }).defaultNow().notNull(),
  /** Último error reportado por el agente/impresora (diagnóstico). */
  ultimoError: text('ultimo_error'),
  /** Numeración fiscal devuelta por la memoria fiscal al imprimir (autoridad de numeración). */
  numeroFiscal: text('numero_fiscal'),
  controlFiscal: text('control_fiscal'),
  /** Acuse del hardware cuando el estado es IMPRESO (fehaciencia). */
  acuse: jsonb('acuse'),
  reclamadoAt: timestamp('reclamado_at', { withTimezone: true }),
  impresoAt: timestamp('impreso_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
