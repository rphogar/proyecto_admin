import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { branches } from './branches';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';

/**
 * `journal_lines` — líneas de asiento en TRIPLE base (docs/05 §3.5, regla 10 de CLAUDE.md).
 * Tenant-scoped → RLS. Cada línea guarda el mismo monto en moneda origen, base fiscal VES y
 * base gerencial USD, con sus tasas congeladas (informativas).
 *
 * Montos en `NUMERIC(20,8)` (regla 1: nunca float). El lado `dc` (D|C) y la no-negatividad de
 * los montos se restringen con CHECK en la migración 0006. `es_ajuste` marca líneas de
 * diferencial cambiario / redondeo, que se EXCLUYEN del cuadre por moneda origen (docs/03 §4.2).
 */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    /** Orden de la línea dentro del asiento (1..n). */
    lineaNo: integer('linea_no').notNull(),
    sucursalId: uuid('sucursal_id').references(() => branches.id),
    centroCosto: text('centro_costo'),
    dc: text('dc').notNull(),
    /** Moneda de la operación de esta línea. */
    moneda: text('moneda').notNull(),
    montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
    rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
    /** Base fiscal (verdad legal). */
    montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
    /** Base gerencial. */
    montoUsdMgmt: numeric('monto_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
    esAjuste: boolean('es_ajuste').notNull().default(false),
    partyId: uuid('party_id'),
    vencimiento: date('vencimiento'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('journal_lines_entry_linea_uq').on(t.entryId, t.lineaNo)],
);
