import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { branches } from './branches';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `transferencias` — transferencia interna entre dos cuentas propias de la empresa (P11, docs/06 M4,
 * docs/03 §4.2). Tenant-scoped → RLS. Mueve dinero de `origen` a `destino`; cuando las monedas
 * difieren (p.ej. comprar USD con Bs) hay **conversión** y, si las tasas de carga difieren, un
 * **diferencial cambiario** (4.7/6.7) que se registra como asiento, jamás se absorbe (regla 11).
 *
 * El registro es una transacción única (como el cobro): `calcularTransferencia` → asiento POSTED
 * (D cuenta destino / C cuenta origen + diferencial en triple base) → fila `transferencias` →
 * auditoría. La transferencia POSTED es **inmutable** (regla 4): trigger en 0034 además de la capa
 * de aplicación; las correcciones se hacen con una transferencia de reverso. Tasas congeladas y
 * totales en triple base (regla 10); la fecha fiscal (Caracas) corta el período.
 */
export const transferencias = pgTable('transferencias', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  /** Cuenta contable de origen (de donde sale el dinero). */
  origenCuentaId: uuid('origen_cuenta_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  /** Cuenta contable de destino (a donde entra el dinero). */
  destinoCuentaId: uuid('destino_cuenta_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'restrict' }),
  monedaOrigen: text('moneda_origen').notNull(),
  montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
  monedaDestino: text('moneda_destino').notNull(),
  montoDestino: numeric('monto_destino', { precision: 20, scale: 8 }).notNull(),
  /** Tasa BCV congelada de la fecha de la transferencia (Bs/divisa). */
  rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
  /** Tasa gerencial congelada (Bs/USD). */
  rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
  /** Diferencial cambiario realizado en Bs (firmado: + ganancia / − pérdida). */
  diferencialVes: numeric('diferencial_ves', { precision: 20, scale: 8 }),
  /** Asiento generado en la transacción de la transferencia. */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  /** Instante de la transferencia (UTC); la fecha fiscal/período se derivan en Caracas. */
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  fechaFiscal: date('fecha_fiscal').notNull(),
  descripcion: text('descripcion'),
  hashIntegridad: text('hash_integridad'),
  /** POSTED (CHECK en 0034). Una transferencia nace POSTED. */
  status: text('status').notNull().default('POSTED'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
