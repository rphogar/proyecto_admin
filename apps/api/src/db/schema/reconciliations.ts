import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { bankAccounts } from './bank-accounts';
import { companies } from './companies';
import { journalLines } from './journal-lines';
import { statementLines } from './statement-lines';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `reconciliations` — emparejamiento (matching) entre el extracto del banco y los movimientos del
 * sistema (P11, docs/06 M4 "feature estrella"). Tenant-scoped → RLS. Soporta **n:m**: una
 * conciliación es el conjunto de filas que comparten `grupo_id`; cada fila enlaza UN lado banco
 * (`statement_line_id`) con UN lado sistema (`journal_line_id`, sobre la cuenta contable del banco).
 *
 * - **1:1** → un grupo con una sola fila (banco ↔ sistema).
 * - **1:n** → un banco contra n del sistema → n filas (mismo `statement_line_id`, distintos
 *   `journal_line_id`).
 * - **n:1** → n del banco contra uno del sistema → n filas (mismo `journal_line_id`).
 *
 * `score` (0–100) es la confianza del auto-match (monto+fecha+referencia). `estado` viaja
 * SUGERIDO → CONCILIADO | EN_TRANSITO | DESCARTADO. Una partida "en tránsito" o "movimiento faltante"
 * puede tener uno de los dos lados en NULL.
 */
export const reconciliations = pgTable('reconciliations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  bankAccountId: uuid('bank_account_id')
    .notNull()
    .references(() => bankAccounts.id, { onDelete: 'cascade' }),
  /** Agrupa las filas de una misma conciliación (1:n / n:1). */
  grupoId: uuid('grupo_id').notNull(),
  /** Lado banco (NULL en un movimiento del sistema sin contraparte en el extracto). */
  statementLineId: uuid('statement_line_id').references(() => statementLines.id, { onDelete: 'cascade' }),
  /** Lado sistema: línea de asiento sobre la cuenta del banco (NULL en movimiento faltante). */
  journalLineId: uuid('journal_line_id').references(() => journalLines.id, { onDelete: 'set null' }),
  /** UNO_A_UNO | UNO_A_N | N_A_UNO (CHECK en 0034). */
  tipo: text('tipo').notNull().default('UNO_A_UNO'),
  /** Confianza del auto-match (0–100). */
  score: numeric('score', { precision: 5, scale: 2 }),
  /** SUGERIDO | CONCILIADO | EN_TRANSITO | DESCARTADO (CHECK en 0034). */
  estado: text('estado').notNull().default('SUGERIDO'),
  conciliadoPor: uuid('conciliado_por').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
