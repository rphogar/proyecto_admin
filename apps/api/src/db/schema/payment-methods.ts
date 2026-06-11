import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `payment_methods` — métodos de pago por empresa, cada uno mapeado a una cuenta contable y a si
 * causa IGTF (docs/05 §3.6, doc 06 M12). Company-scoped → RLS.
 *
 * `codigo` clasifica el método (EFECTIVO_BS, EFECTIVO_USD, PAGO_MOVIL, TRANSFERENCIA, PUNTO_VENTA,
 * ZELLE, USDT, OTRO — CHECK). `cuenta_id` apunta al plan de cuentas (`accounts`): los cobros/pagos
 * por este método se contabilizan contra esa cuenta (plantillas de contabilización, P-tesorería).
 * `causa_igtf` marca los pagos que generan IGTF (divisas/cripto fuera del sistema bancario, docs/02
 * §IGTF, caso 34); el % vive en `fiscal_params` (regla 17). La unicidad es `(company_id, codigo)`.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** EFECTIVO_BS | EFECTIVO_USD | PAGO_MOVIL | TRANSFERENCIA | PUNTO_VENTA | ZELLE | USDT | OTRO. */
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** Moneda del método: VES | USD | EUR (CHECK). */
    moneda: text('moneda').notNull().default('VES'),
    /** Cuenta contable contra la que se asienta el movimiento (plan de cuentas de la empresa). */
    cuentaId: uuid('cuenta_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** El método causa IGTF (divisas/cripto fuera de banca nacional, caso 34). */
    causaIgtf: boolean('causa_igtf').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('payment_methods_company_codigo_uq').on(t.companyId, t.codigo)],
);
