import { numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { cierresCaja } from './cierres-caja';
import { companies } from './companies';
import { paymentMethods } from './payment-methods';
import { tenants } from './tenants';

/**
 * `cierre_caja_arqueos` — detalle del arqueo de un cierre de caja, una fila por método de pago
 * (P11, docs/06 M1/M4, caso 5). Tenant-scoped → RLS. `monto_sistema` es lo esperado (derivado de los
 * movimientos reales del turno para ese método); `monto_declarado` es el conteo físico del cajero;
 * `diferencia = declarado − sistema` (firmado: + sobrante / − faltante).
 *
 * Inmutable cuando el cierre padre está CERRADO (trigger en 0034, modelo cobros). Unicidad
 * `(cierre, método)`.
 */
export const cierreCajaArqueos = pgTable(
  'cierre_caja_arqueos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    cierreId: uuid('cierre_id')
      .notNull()
      .references(() => cierresCaja.id, { onDelete: 'cascade' }),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    moneda: text('moneda').notNull(),
    /** Esperado por el sistema (derivado de los movimientos del turno), en la moneda del método. */
    montoSistema: numeric('monto_sistema', { precision: 20, scale: 8 }).notNull(),
    /** Declarado por el cajero (arqueo físico), en la moneda del método. */
    montoDeclarado: numeric('monto_declarado', { precision: 20, scale: 8 }).notNull(),
    /** declarado − sistema (firmado: + sobrante / − faltante). */
    diferencia: numeric('diferencia', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('cierre_caja_arqueos_cierre_metodo_uq').on(t.cierreId, t.paymentMethodId)],
);
