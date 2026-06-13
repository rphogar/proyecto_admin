import { boolean, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cobros } from './cobros';
import { companies } from './companies';
import { paymentMethods } from './payment-methods';
import { tenants } from './tenants';

/**
 * `cobro_medios` — porciones del cobro por método de pago (split multimoneda; docs/06 M3, caso 4).
 * Tenant-scoped → RLS. Cada porción guarda su moneda y triple base a la tasa del cobro; `es_vuelto`
 * marca la salida de caja por el vuelto entregado (arqueo real, caso 5). `causa_igtf` es el snapshot
 * del método al momento del cobro (la porción en divisas genera IGTF, caso 4/34).
 */
export const cobroMedios = pgTable('cobro_medios', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  cobroId: uuid('cobro_id')
    .notNull()
    .references(() => cobros.id, { onDelete: 'cascade' }),
  paymentMethodId: uuid('payment_method_id')
    .notNull()
    .references(() => paymentMethods.id),
  moneda: text('moneda').notNull(),
  montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
  rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
  montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
  montoUsdMgmt: numeric('monto_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
  /** El método causa IGTF (divisas/cripto fuera de banca nacional). Snapshot al cobrar. */
  causaIgtf: boolean('causa_igtf').notNull().default(false),
  /** La porción es un vuelto entregado (salida de caja), no un ingreso. */
  esVuelto: boolean('es_vuelto').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
