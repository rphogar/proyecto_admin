import { integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { items } from './items';
import { purchases } from './purchases';
import { tenants } from './tenants';

/**
 * `purchase_lines` — renglones de la factura de compra en TRIPLE base (P9, regla 10). Tenant-scoped →
 * RLS. Inmutables cuando la compra padre está REGISTERED (trigger en 0026).
 *
 * Espejo de `document_lines` para el lado de compras: cada línea congela su alícuota
 * (`alicuota_codigo` + `alicuota_tasa`) y guarda base e IVA (crédito fiscal soportado) en las tres
 * expresiones del monto. `NUMERIC(20,8)` (regla 1); el redondeo fiscal a 2 decimales ocurre en el
 * agregado por alícuota (`purchase_taxes`) y en los totales.
 */
export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    /** Orden de la línea dentro de la compra (1..n). */
    lineaNo: integer('linea_no').notNull(),
    /** Ítem del maestro; NULL = línea de texto libre. */
    itemId: uuid('item_id').references(() => items.id),
    descripcion: text('descripcion').notNull(),
    cantidad: numeric('cantidad', { precision: 20, scale: 8 }).notNull(),
    precioUnitarioOrigen: numeric('precio_unitario_origen', { precision: 20, scale: 8 }).notNull(),
    descuentoOrigen: numeric('descuento_origen', { precision: 20, scale: 8 }).notNull().default('0'),
    /** GENERAL | REDUCIDA | ADICIONAL | EXENTO | EXONERADO | EXPORTACION (CHECK en 0026). */
    alicuotaCodigo: text('alicuota_codigo').notNull(),
    alicuotaTasa: numeric('alicuota_tasa', { precision: 5, scale: 2 }).notNull(),
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }).notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    baseUsdMgmt: numeric('base_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    ivaOrigen: numeric('iva_origen', { precision: 20, scale: 8 }).notNull().default('0'),
    ivaVes: numeric('iva_ves', { precision: 20, scale: 8 }).notNull().default('0'),
    ivaUsdMgmt: numeric('iva_usd_mgmt', { precision: 20, scale: 8 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('purchase_lines_purchase_linea_uq').on(t.purchaseId, t.lineaNo)],
);
