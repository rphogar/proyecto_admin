import { type AnyPgColumn, date, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { exchangeRates } from './exchange-rates';
import { journalEntries } from './journal-entries';
import { parties } from './parties';
import { series } from './series';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `documents` — cabecera del núcleo administrativo (docs/05 §3.4). Tenant-scoped → RLS.
 *
 * **Inmutabilidad (regla 4 / Providencia 121):** una vez `status='ISSUED'` (o `APPLIED`), no
 * admite UPDATE ni DELETE; lo hace cumplir el trigger `documents_inmutable` (migración 0017)
 * además de la capa de aplicación. Las correcciones se hacen con nota de crédito/débito que
 * referencia el documento afectado (`affected_document_id`), nunca editando el original.
 *
 * **Numeración (regla 6, docs/05 §4):** `number` se asigna en la MISMA transacción de emisión con
 * `UPDATE series SET next_number = next_number + 1 ... RETURNING next_number - 1` (contador
 * transaccional, sin huecos). Un DRAFT aún no tiene `number` (NULL); al emitir queda
 * estrictamente consecutivo por serie (unique parcial en 0017). `control_number` es el número de
 * control (preimpreso en formas libres, digital en la 00102).
 *
 * **Multimoneda (regla 10):** la tasa se congela por documento (`exchange_rate_id`, `rate_bcv`,
 * `rate_usd_mgmt`) y todos los totales se guardan en triple base. La "fecha fiscal"
 * (`issue_fecha_fiscal`, civil en Caracas — regla 15) es la que corta períodos y libros.
 *
 * Al emitir, la transacción también genera el asiento (`journal_entry_id`) y el evento de
 * auditoría. `party_rif`/`party_nombre` son SNAPSHOTS al momento de emitir (el documento fiscal es
 * inalterable aunque el maestro del tercero cambie luego).
 */
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  /** Tipo de documento (docs/05 §3.4). Mismo dominio que `series.doc_type` (CHECK en 0017). */
  type: text('type').notNull(),
  seriesId: uuid('series_id')
    .notNull()
    .references(() => series.id),
  /** Correlativo asignado por la serie al emitir. NULL mientras es DRAFT. */
  number: integer('number'),
  /** Número de control (formas libres preimpreso / imprenta digital 00102). */
  controlNumber: text('control_number'),
  /** DRAFT | ISSUED | CANCELLED (solo pre-emisión) | APPLIED (CHECK en 0017). */
  status: text('status').notNull().default('DRAFT'),
  /** Medio de emisión (FORMA_LIBRE | MAQUINA_FISCAL | IMPRENTA_DIGITAL). Gobierna el nro de control. */
  medioEmision: text('medio_emision').notNull().default('FORMA_LIBRE'),
  partyId: uuid('party_id').references(() => parties.id),
  /** Snapshot del RIF del adquirente al emitir (NULL = consumidor final). */
  partyRif: text('party_rif'),
  /** Snapshot del nombre/razón social del adquirente al emitir. */
  partyNombre: text('party_nombre'),
  /** Instante de emisión (UTC). La fecha fiscal/período se derivan en Caracas. */
  issueDate: timestamp('issue_date', { withTimezone: true }).notNull(),
  /** Fecha fiscal civil en Caracas `YYYY-MM-DD` (regla 15): corta períodos y libros. */
  issueFechaFiscal: date('issue_fecha_fiscal').notNull(),
  currency: text('currency').notNull(),
  exchangeRateId: uuid('exchange_rate_id').references(() => exchangeRates.id),
  /** Tasa BCV congelada (Bs por unidad de `currency`); NULL si `currency`=VES. */
  rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
  /** Tasa gerencial congelada (Bs/USD). */
  rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
  /** CONTADO | CREDITO (CHECK en 0017). */
  paymentCondition: text('payment_condition'),
  /** NC/ND → factura afectada (self-FK, docs/05 §3.4). */
  affectedDocumentId: uuid('affected_document_id').references((): AnyPgColumn => documents.id),
  /** Asiento generado en la transacción de emisión (regla 5/§4). */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  /** Totales en triple base (regla 10). El detalle por alícuota vive en `document_taxes`. */
  totalOrigen: numeric('total_origen', { precision: 20, scale: 8 }),
  totalVes: numeric('total_ves', { precision: 20, scale: 8 }),
  totalUsdMgmt: numeric('total_usd_mgmt', { precision: 20, scale: 8 }),
  /** Hash de integridad del documento emitido (cadena inviolable, Providencia 121). */
  hashIntegridad: text('hash_integridad'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
