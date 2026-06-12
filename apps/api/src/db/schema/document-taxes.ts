import { numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { tenants } from './tenants';

/**
 * `document_taxes` — IVA discriminado por alícuota (docs/05 §3.4, regla 4 fiscal de docs/02 §11).
 * Tenant-scoped → RLS. Inmutables cuando el documento padre está ISSUED/APPLIED (trigger en 0017).
 *
 * Es la **fuente única** de los libros de compras/ventas y de la declaración de IVA (docs/02 §7.2,
 * §11.8: "si el libro no cuadra con la planilla, hay un bug"). Una fila por alícuota del documento,
 * con base y monto ya redondeados fiscalmente (2 decimales) en triple base. La unicidad
 * `(document, alicuota)` garantiza que no haya renglones duplicados de la misma alícuota.
 */
export const documentTaxes = pgTable(
  'document_taxes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** GENERAL | REDUCIDA | ADICIONAL | EXENTO | EXONERADO | EXPORTACION (CHECK en 0017). */
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
  (t) => [unique('document_taxes_document_alicuota_uq').on(t.documentId, t.alicuotaCodigo)],
);
