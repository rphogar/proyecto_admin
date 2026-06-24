import { date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `company_aperturas` — marcador de la APERTURA de una empresa (P30, docs/06 flujo #5, caso 45).
 * Tenant-scoped → RLS. Una empresa tiene **a lo sumo una** apertura (`company_id` único): es el seam
 * idempotente del asistente de onboarding y el punto de integración de los importadores de saldos
 * iniciales (P31). El detalle de los saldos vive en el asiento de apertura (`journal_lines`, con
 * `party_id`/`vencimiento`) y, para el inventario, en `stock_moves` (tipo `APERTURA`, con costo y
 * fecha de origen para reexpresión); esta tabla solo enlaza la empresa con su asiento de apertura.
 */
export const companyAperturas = pgTable(
  'company_aperturas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Asiento de apertura (POSTED) que estableció los saldos iniciales. */
    journalEntryId: uuid('journal_entry_id')
      .notNull()
      .references(() => journalEntries.id),
    /** Fecha fiscal (Caracas) de la apertura; también es la fecha de origen del capital. */
    fechaApertura: date('fecha_apertura').notNull(),
    /** REGISTRADA — estado del proceso (deja sitio a futuros estados, p.ej. revisión). */
    estado: text('estado').notNull().default('REGISTRADA'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('company_aperturas_company_uq').on(t.companyId)],
);
