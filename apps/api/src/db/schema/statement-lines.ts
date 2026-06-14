import { date, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { bankStatements } from './bank-statements';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `statement_lines` — una línea (movimiento) del estado de cuenta importado (P11, docs/06 M4).
 * Company-scoped → RLS. El `monto` es **firmado** en la convención del extracto: positivo = abono
 * (entra dinero al banco), negativo = cargo (sale). El motor de matching enfrenta estas líneas
 * PENDIENTES contra los movimientos del sistema (journal_lines de la cuenta del banco).
 *
 * `hash_linea` deduplica dentro del estado (idempotencia de la importación; unicidad
 * `(statement, hash_linea)`). `estado` viaja PENDIENTE → CONCILIADO | EN_TRANSITO | DESCARTADO según
 * la conciliación; por eso la fila NO es inmutable (sí RLS). El detalle del match vive en
 * `reconciliations`.
 */
export const statementLines = pgTable(
  'statement_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    statementId: uuid('statement_id')
      .notNull()
      .references(() => bankStatements.id, { onDelete: 'cascade' }),
    fecha: date('fecha').notNull(),
    descripcion: text('descripcion'),
    referencia: text('referencia'),
    /** Monto firmado: + abono (entra) / − cargo (sale), en la moneda del banco. */
    monto: numeric('monto', { precision: 20, scale: 8 }).notNull(),
    moneda: text('moneda').notNull().default('VES'),
    /** Saldo informado por el banco tras el movimiento (si el extracto lo trae). */
    saldo: numeric('saldo', { precision: 20, scale: 8 }),
    hashLinea: text('hash_linea').notNull(),
    /** PENDIENTE | CONCILIADO | EN_TRANSITO | DESCARTADO (CHECK en 0034). */
    estado: text('estado').notNull().default('PENDIENTE'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('statement_lines_statement_hash_uq').on(t.statementId, t.hashLinea)],
);
