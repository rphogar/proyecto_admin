import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `price_lists` — listas de precios por empresa (docs/05 §3.2, doc 06 M5). Company-scoped → RLS.
 *
 * Cada lista fija su `moneda` (VES|USD|EUR): los precios de `item_prices` se expresan en esa
 * moneda y se convierten a la tasa del documento al facturar. `es_default` marca la lista usada
 * por defecto en el editor de factura. La unicidad es `(company_id, codigo)`.
 */
export const priceLists = pgTable(
  'price_lists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** Moneda de los precios de la lista: VES | USD | EUR (CHECK). */
    moneda: text('moneda').notNull().default('USD'),
    esDefault: boolean('es_default').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('price_lists_company_codigo_uq').on(t.companyId, t.codigo)],
);
