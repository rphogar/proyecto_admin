import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { parties } from './parties';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `cobros` — cabecera del cobro de una o varias facturas (docs/06 M3, docs/03 §4.2). Tenant-scoped →
 * RLS. Como registro financiero, un cobro POSTED es **inmutable** (regla 4): trigger en la migración
 * 0022 además de la capa de aplicación; las correcciones se hacen con un cobro de reverso.
 *
 * El asiento del cobro (`journal_entry_id`) integra: entradas de caja por método, IGTF percibido
 * (2.3.05), diferencial cambiario realizado (4.7/6.7) y vuelto. Totales en triple base (regla 10);
 * la fecha fiscal (Caracas) corta períodos. El detalle por método vive en `cobro_medios` y la
 * imputación a facturas en `cobro_aplicaciones`.
 */
export const cobros = pgTable('cobros', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  partyId: uuid('party_id').references(() => parties.id),
  /** Instante del cobro (UTC); la fecha fiscal/período se derivan en Caracas. */
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  fechaFiscal: date('fecha_fiscal').notNull(),
  /** Asiento generado en la transacción del cobro. */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  /** IGTF percibido en este cobro, en Bs (informativo; el detalle va en el asiento). */
  igtfTotalVes: numeric('igtf_total_ves', { precision: 20, scale: 8 }),
  /** Total cobrado (aplicado a CxC) en triple base. */
  totalOrigen: numeric('total_origen', { precision: 20, scale: 8 }),
  totalVes: numeric('total_ves', { precision: 20, scale: 8 }),
  totalUsdMgmt: numeric('total_usd_mgmt', { precision: 20, scale: 8 }),
  /** Hash de integridad del cobro (cadena inviolable, Providencia 121). */
  hashIntegridad: text('hash_integridad'),
  /** DRAFT | POSTED (CHECK en 0022). Un cobro nace POSTED. */
  status: text('status').notNull().default('POSTED'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
