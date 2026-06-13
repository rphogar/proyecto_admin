import { date, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { parties } from './parties';
import { purchases } from './purchases';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `retentions_issued` — comprobantes de retención (IVA o ISLR) EMITIDOS por la empresa como agente
 * de retención (P9, docs/05 §3.7, docs/02 §3.3/§4). Tenant-scoped → RLS.
 *
 * Cada fila documenta un comprobante entregado al proveedor: numeración normada
 * `AAAAMMNNNNNNNN` (período de imputación + correlativo de 8 dígitos, consecutivo y sin huecos por
 * `(company, tipo)` — patrón de contador transaccional, docs/05 §4), la factura de compra afectada,
 * la base, el porcentaje/tarifa y el monto retenido, en triple base. El pasivo por enterar
 * (2.3.03 IVA / 2.3.04 ISLR) se acredita en el asiento de la **compra** (`purchases.journal_entry_id`):
 * este registro alimenta el comprobante PDF, el TXT del portal SENIAT y la declaración de retenciones.
 *
 * Inmutable una vez emitido (regla 4): trigger en 0026. La unicidad
 * `(company, tipo, numero_comprobante)` garantiza que no se repita un comprobante.
 */
export const retentionsIssued = pgTable(
  'retentions_issued',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Compra (factura del proveedor) sobre la que se practica la retención. */
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    /** Proveedor retenido. */
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id),
    proveedorRif: text('proveedor_rif').notNull(),
    proveedorNombre: text('proveedor_nombre').notNull(),
    /** IVA | ISLR (CHECK en 0026). */
    tipo: text('tipo').notNull(),
    /** Número de comprobante `AAAAMMNNNNNNNN`. */
    numeroComprobante: text('numero_comprobante').notNull(),
    /** Correlativo (8 dígitos) dentro del período/tipo; soporta detección de huecos. */
    correlativo: integer('correlativo').notNull(),
    /** Período de imputación (cuando se practica la retención). */
    periodoAnio: integer('periodo_anio').notNull(),
    periodoMes: integer('periodo_mes').notNull(),
    /** Concepto de pago (solo ISLR): honorarios, servicios, arrendamiento… */
    conceptoIslr: text('concepto_islr'),
    currency: text('currency').notNull(),
    rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
    /**
     * Base de la retención. IVA: IVA facturado. ISLR: porción del pago gravada por el concepto.
     * En triple base no es necesario aquí; se guarda origen y VES (la base fiscal).
     */
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }).notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    /** Porcentaje (IVA: 75/100) o tarifa (ISLR: 3/5/1/2…) en %. */
    porcentaje: numeric('porcentaje', { precision: 5, scale: 2 }).notNull(),
    /** Sustraendo aplicado (solo ISLR PN); 0 en IVA y PJ. */
    sustraendoVes: numeric('sustraendo_ves', { precision: 20, scale: 8 }).notNull().default('0'),
    /** Monto retenido en moneda origen y en Bs (base fiscal). */
    montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
    montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
    fechaFiscal: date('fecha_fiscal').notNull(),
    /** Línea TXT del portal SENIAT (solo IVA), congelada al emitir para la declaración. */
    txtExport: text('txt_export'),
    hashIntegridad: text('hash_integridad'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('retentions_issued_company_tipo_numero_uq').on(t.companyId, t.tipo, t.numeroComprobante)],
);
