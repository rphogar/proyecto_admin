import { numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { purchases } from './purchases';
import { tenants } from './tenants';

/**
 * `purchase_taxes` — IVA (crédito fiscal) discriminado por alícuota de una factura de compra (P9,
 * docs/02 §7.2). Tenant-scoped → RLS. Inmutables cuando la compra está REGISTERED (trigger en 0026).
 *
 * Es la **fuente única** del Libro de Compras y del crédito fiscal de la declaración de IVA (docs/02
 * §11.8: "si el libro no cuadra con la planilla, hay un bug"). Una fila por alícuota, con base y
 * monto ya redondeados fiscalmente (2 decimales) en triple base.
 */
export const purchaseTaxes = pgTable(
  'purchase_taxes',
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
    /** GENERAL | REDUCIDA | ADICIONAL | EXENTO | EXONERADO | EXPORTACION (CHECK en 0026). */
    alicuotaCodigo: text('alicuota_codigo').notNull(),
    alicuotaTasa: numeric('alicuota_tasa', { precision: 5, scale: 2 }).notNull(),
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }).notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    baseUsdMgmt: numeric('base_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
    montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
    montoUsdMgmt: numeric('monto_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('purchase_taxes_purchase_alicuota_uq').on(t.purchaseId, t.alicuotaCodigo)],
);
