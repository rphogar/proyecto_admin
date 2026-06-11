import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `warehouses` — almacenes/depósitos por empresa (docs/05 §3.2, doc 06 M5). Company-scoped → RLS.
 *
 * Un almacén puede asociarse opcionalmente a una sucursal (`branch_id`). El kardex y los
 * `stock_moves` (P-inventario) referencian al almacén. La unicidad es `(company_id, codigo)`.
 */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Sucursal a la que pertenece el almacén; NULL = almacén central de la empresa. */
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    direccion: text('direccion'),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('warehouses_company_codigo_uq').on(t.companyId, t.codigo)],
);
