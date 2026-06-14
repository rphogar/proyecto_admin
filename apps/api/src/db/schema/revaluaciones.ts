import { date, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `revaluaciones` — corrida mensual de revaluación de saldos en divisas (P11, docs/03 §4.2 "no
 * realizado", caso 11). Tenant-scoped → RLS. Al cierre de mes, los saldos en divisas (caja USD,
 * Zelle, USDT, bancos divisa, CxC/CxP en divisas) se revalúan a la **tasa BCV de cierre**: el
 * diferencial NO realizado se registra con un asiento de ajuste fechado el último día del mes
 * (`journal_entry_id`) y su **reverso** fechado el día 1 del mes siguiente (`reverso_entry_id`).
 *
 * La unicidad `(company, anio, mes)` garantiza la **idempotencia** (caso 11): re-ejecutar la corrida
 * reversa el asiento previo y regenera, nunca duplica el ajuste. La corrida POSTED es inmutable
 * (trigger en 0034); su efecto se deshace por el reverso, no editando la fila.
 */
export const revaluaciones = pgTable(
  'revaluaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    anio: integer('anio').notNull(),
    mes: integer('mes').notNull(),
    /** Fecha de corte (último día del mes, Caracas) a la que se revalúan los saldos. */
    fechaCorte: date('fecha_corte').notNull(),
    /** Tasa BCV de cierre usada (Bs/USD), congelada. */
    rateCierre: numeric('rate_cierre', { precision: 20, scale: 8 }),
    /** Asiento de ajuste (último día del mes). */
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    /** Reverso del ajuste (día 1 del mes siguiente). */
    reversoEntryId: uuid('reverso_entry_id').references(() => journalEntries.id),
    /** Diferencial NO realizado total en Bs (firmado: + ganancia / − pérdida). */
    diferencialVes: numeric('diferencial_ves', { precision: 20, scale: 8 }),
    /** POSTED (CHECK en 0034). */
    status: text('status').notNull().default('POSTED'),
    hash: text('hash'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('revaluaciones_company_periodo_uq').on(t.companyId, t.anio, t.mes)],
);
