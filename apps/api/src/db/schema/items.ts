import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `items` — ítems del catálogo: productos y servicios (docs/05 §3.2). Maestro company-scoped →
 * RLS. La unicidad es `(company_id, sku)`.
 *
 * `alicuota_iva` es la CATEGORÍA fiscal del ítem (no el % numérico): el % vive en `fiscal_params`
 * con vigencia (regla 17, caso 14 cambio de alícuota a mitad de mes) y lo resuelve el motor
 * fiscal en P7+. Categorías de docs/05 §3.2 + docs/02 §3.1:
 * GENERAL (16%) | REDUCIDA (8%) | ADICIONAL (suntuario +15%) | EXENTO (por ley) |
 * EXONERADO (por decreto) | EXPORTACION (0% con derecho a crédito, caso 22).
 *
 * Los precios NO viven aquí: son multimoneda por lista de precios en `item_prices` (docs/05 §3.2
 * "precios multimoneda con lista de precios", doc 06 M5). `control_lote`/`control_serial` activan
 * el manejo de lotes/seriales/vencimientos por ítem (configurable, doc 06 M5).
 */
export const items = pgTable(
  'items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    descripcion: text('descripcion').notNull(),
    /** producto | servicio (CHECK en la migración de constraints). */
    tipo: text('tipo').notNull(),
    /** GENERAL | REDUCIDA | ADICIONAL | EXENTO | EXONERADO | EXPORTACION (CHECK). */
    alicuotaIva: text('alicuota_iva').notNull().default('GENERAL'),
    /** Unidad de medida (UND, KG, LT, HORA…). */
    unidad: text('unidad').notNull().default('UND'),
    controlLote: boolean('control_lote').notNull().default(false),
    controlSerial: boolean('control_serial').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('items_company_sku_uq').on(t.companyId, t.sku)],
);
