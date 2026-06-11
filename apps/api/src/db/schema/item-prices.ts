import { numeric, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { items } from './items';
import { priceLists } from './price-lists';
import { tenants } from './tenants';

/**
 * `item_prices` — precio de un ítem en una lista de precios (junction ítem × lista, docs/05 §3.2
 * "precios multimoneda con lista de precios"). Company-scoped → RLS. `tenant_id`/`company_id` se
 * desnormalizan para que la política de RLS sea uniforme (igual que `journal_lines`).
 *
 * `precio` en `NUMERIC(20,8)` (regla 1: nunca float para dinero) en la moneda de la lista. La
 * unicidad es `(price_list_id, item_id)`: un ítem tiene a lo sumo un precio por lista.
 */
export const itemPrices = pgTable(
  'item_prices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Precio del ítem en la moneda de la lista (regla 1). */
    precio: numeric('precio', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('item_prices_list_item_uq').on(t.priceListId, t.itemId)],
);
