import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `branches` — sucursales de una empresa (`tenant → companies → branches`, docs/05 §2).
 * Tenant-scoped → RLS. `tenant_id` se mantiene desnormalizado en cada tabla de negocio para
 * que la política de RLS sea uniforme (regla 12), aunque sea derivable vía `company_id`.
 */
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    codigo: text('codigo').notNull(),
    direccion: text('direccion'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('branches_company_codigo_uq').on(t.companyId, t.codigo)],
);
