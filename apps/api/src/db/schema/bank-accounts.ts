import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `bank_accounts` — cuenta bancaria propia de la empresa (P11, docs/05 §3.6, docs/06 M4).
 * Company-scoped → RLS. Cada cuenta bancaria mapea a una cuenta contable del plan (`accounts`):
 * 1.1.03 Bancos Bs, 1.1.04 custodia USD, 1.1.05 cuentas en el exterior, etc. Los cobros, pagos y
 * transferencias contra este banco se contabilizan en esa cuenta, y la conciliación enfrenta las
 * `journal_lines` de esa cuenta contra las `statement_lines` importadas.
 *
 * `banco` clasifica la institución (BANESCO|MERCANTIL|BNC|PROVINCIAL|BDV|OTRO — CHECK); el parser de
 * estados de cuenta se elige por este código. `numero_mascara` guarda solo los últimos dígitos (dato
 * sensible: nunca el número completo en claro, regla 14). La unicidad es `(company, banco, máscara)`.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** BANESCO | MERCANTIL | BNC | PROVINCIAL | BDV | OTRO (CHECK en 0034). */
    banco: text('banco').notNull(),
    nombre: text('nombre').notNull(),
    /** Últimos dígitos de la cuenta (enmascarada; regla 14). */
    numeroMascara: text('numero_mascara').notNull(),
    /** Moneda de la cuenta: VES | USD | EUR (CHECK en 0034). */
    moneda: text('moneda').notNull().default('VES'),
    /** Cuenta contable del plan contra la que se asientan los movimientos del banco. */
    cuentaId: uuid('cuenta_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('bank_accounts_company_banco_mascara_uq').on(t.companyId, t.banco, t.numeroMascara)],
);
