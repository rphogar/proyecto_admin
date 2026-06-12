import { integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { items } from './items';
import { tenants } from './tenants';

/**
 * `document_lines` — renglones del documento en TRIPLE base (docs/05 §3.4, regla 10). Tenant-scoped
 * → RLS. Inmutables cuando el documento padre está ISSUED/APPLIED (trigger en 0017).
 *
 * Cada línea congela su alícuota (`alicuota_codigo` + `alicuota_tasa`) y guarda base e IVA en las
 * tres expresiones del monto (origen, base fiscal VES, base gerencial USD). Los montos van en
 * `NUMERIC(20,8)` (regla 1: nunca float); el redondeo fiscal a 2 decimales ocurre en el agregado por
 * alícuota (`document_taxes`) y en los totales, no en el almacenamiento intermedio.
 */
export const documentLines = pgTable(
  'document_lines',
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
    /** Orden de la línea dentro del documento (1..n). */
    lineaNo: integer('linea_no').notNull(),
    /** Ítem del maestro; NULL = línea de texto libre. */
    itemId: uuid('item_id').references(() => items.id),
    descripcion: text('descripcion').notNull(),
    cantidad: numeric('cantidad', { precision: 20, scale: 8 }).notNull(),
    precioUnitarioOrigen: numeric('precio_unitario_origen', { precision: 20, scale: 8 }).notNull(),
    descuentoOrigen: numeric('descuento_origen', { precision: 20, scale: 8 }).notNull().default('0'),
    /** GENERAL | REDUCIDA | ADICIONAL | EXENTO | EXONERADO | EXPORTACION (CHECK en 0017). */
    alicuotaCodigo: text('alicuota_codigo').notNull(),
    /** Tasa de IVA aplicada (16.00, 8.00, 0). Parámetro de entrada; el motor de IVA es P7. */
    alicuotaTasa: numeric('alicuota_tasa', { precision: 5, scale: 2 }).notNull(),
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }).notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    baseUsdMgmt: numeric('base_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    ivaOrigen: numeric('iva_origen', { precision: 20, scale: 8 }).notNull().default('0'),
    ivaVes: numeric('iva_ves', { precision: 20, scale: 8 }).notNull().default('0'),
    ivaUsdMgmt: numeric('iva_usd_mgmt', { precision: 20, scale: 8 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('document_lines_document_linea_uq').on(t.documentId, t.lineaNo)],
);
