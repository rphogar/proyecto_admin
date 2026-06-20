import { date, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { exchangeRates } from './exchange-rates';
import { journalEntries } from './journal-entries';
import { parties } from './parties';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `purchases` — factura de compra registrada de un proveedor (P9, docs/05 §3.4/§3.7, docs/06 M2).
 * Tenant-scoped → RLS. A diferencia de una venta, la numeración (`numero_documento`) y el
 * `numero_control` son **del proveedor** (no se consume serie propia) y son OBLIGATORIOS: sin ellos
 * el documento no entra al Libro de Compras ni da derecho a crédito fiscal (docs/02 §3.3, §7.2).
 *
 * El registro es una **transacción única** (como el cobro): cálculo en triple base → asiento POSTED
 * (D Compras/Gasto/Inventario + D IVA crédito fiscal 1.3.01 ; C Proveedores 2.1 por el NETO ; C
 * Retención IVA por enterar 2.3.03 y C Retención ISLR por enterar 2.3.04 cuando la empresa es
 * agente) → compra REGISTERED + líneas + impuestos + comprobantes de retención → auditoría. La
 * compra REGISTERED es **inmutable** (regla 4): trigger en 0026 además de la capa de aplicación; las
 * correcciones se hacen con un registro de reverso.
 *
 * La tasa se congela por documento (`exchange_rate_id`, `rate_bcv`, `rate_usd_mgmt`) y todos los
 * totales se guardan en triple base (regla 10). La fecha fiscal (Caracas) corta el período del Libro
 * de Compras. La retención de ISLR se calcula sobre `base_islr_*` (porción del concepto gravado —
 * caso 32) por `concepto_islr` con `tarifa_islr` y `sustraendo_islr` resueltos de parámetros.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id),
    /** Snapshot del RIF del proveedor al registrar. */
    proveedorRif: text('proveedor_rif').notNull(),
    /** Snapshot de la razón social del proveedor al registrar. */
    proveedorNombre: text('proveedor_nombre').notNull(),
    /** FACTURA | NOTA_DEBITO | NOTA_CREDITO (documento del proveedor; CHECK en 0026). */
    tipoDocumento: text('tipo_documento').notNull().default('FACTURA'),
    /** Número de la factura del proveedor (OBLIGATORIO para el Libro de Compras). */
    numeroDocumento: text('numero_documento').notNull(),
    /** Número de control del proveedor (OBLIGATORIO para deducir crédito fiscal). */
    numeroControl: text('numero_control').notNull(),
    /** Documento afectado (para NC/ND del proveedor): número de la factura original. */
    numeroDocumentoAfectado: text('numero_documento_afectado'),
    /**
     * Tipo de operación para el Libro de Compras (Reglamento IVA arts. 70–78): INTERNA |
     * IMPORTACION (CHECK en 0058). La exportación no aplica a compras. Default INTERNA.
     */
    tipoOperacion: text('tipo_operacion').notNull().default('INTERNA'),
    /** Cuenta de destino del gasto/compra (código del plan): 5.2 compras, 6.x gasto, 1.4 inventario. */
    cuentaDestino: text('cuenta_destino').notNull().default('5.2'),
    /** Instante del documento del proveedor (UTC). La fecha fiscal/período se derivan en Caracas. */
    fechaDocumento: timestamp('fecha_documento', { withTimezone: true }).notNull(),
    /** Fecha fiscal civil en Caracas `YYYY-MM-DD` (regla 15): corta el período del Libro de Compras. */
    fechaFiscal: date('fecha_fiscal').notNull(),
    currency: text('currency').notNull(),
    exchangeRateId: uuid('exchange_rate_id').references(() => exchangeRates.id),
    /** Tasa BCV congelada (Bs por unidad de `currency`); NULL si `currency`=VES. */
    rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
    /** Tasa gerencial congelada (Bs/USD). */
    rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
    /** Asiento generado en la transacción de registro. */
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    /** Totales en triple base (regla 10). El detalle por alícuota vive en `purchase_taxes`. */
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }),
    baseUsdMgmt: numeric('base_usd_mgmt', { precision: 20, scale: 8 }),
    ivaOrigen: numeric('iva_origen', { precision: 20, scale: 8 }),
    ivaVes: numeric('iva_ves', { precision: 20, scale: 8 }),
    ivaUsdMgmt: numeric('iva_usd_mgmt', { precision: 20, scale: 8 }),
    totalOrigen: numeric('total_origen', { precision: 20, scale: 8 }),
    totalVes: numeric('total_ves', { precision: 20, scale: 8 }),
    totalUsdMgmt: numeric('total_usd_mgmt', { precision: 20, scale: 8 }),
    /** Retención de IVA practicada en Bs (informativo; el detalle va en `retentions_issued`). */
    retencionIvaVes: numeric('retencion_iva_ves', { precision: 20, scale: 8 }),
    /** Retención de ISLR practicada en Bs (informativo). */
    retencionIslrVes: numeric('retencion_islr_ves', { precision: 20, scale: 8 }),
    hashIntegridad: text('hash_integridad'),
    /** DRAFT | REGISTERED (CHECK en 0026). Una compra nace REGISTERED. */
    status: text('status').notNull().default('REGISTERED'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Un mismo proveedor no puede tener dos veces el mismo número de documento en la empresa.
  (t) => [unique('purchases_company_proveedor_doc_uq').on(t.companyId, t.partyId, t.numeroDocumento)],
);
