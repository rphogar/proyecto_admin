import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `periods` — períodos contables mensuales por empresa (docs/05 §3.5, regla 9 de CLAUDE.md).
 * Tenant-scoped → RLS. Un período CLOSED no acepta asientos con fecha dentro del período;
 * lo hace cumplir el trigger `journal_entries_periodo_abierto` (migración 0006) además de la
 * capa de aplicación (`@contave/ledger`). El año/mes son los del corte fiscal en Caracas.
 *
 * `estado`: OPEN | CLOSED. El rango válido del mes (1–12) y los valores de `estado` se
 * restringen con CHECK en la migración 0006.
 */
export const periods = pgTable(
  'periods',
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
    estado: text('estado').notNull().default('OPEN'),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('periods_company_anio_mes_uq').on(t.companyId, t.anio, t.mes)],
);
