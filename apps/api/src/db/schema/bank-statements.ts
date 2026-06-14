import { date, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { bankAccounts } from './bank-accounts';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `bank_statements` — estado de cuenta importado (P11, docs/05 §3.6, docs/06 M4, integración F1).
 * Company-scoped → RLS. El importador detecta el formato del banco, elige el parser versionado
 * (`parser_version`) y persiste la cabecera + las `statement_lines`.
 *
 * `hash_archivo` (sha256 del contenido) garantiza la **idempotencia** del importador (caso 11
 * trasladado a la importación): re-importar el mismo archivo no duplica movimientos — la unicidad
 * `(company, hash_archivo)` lo impide. `desde`/`hasta` y los saldos inicial/final sirven para cuadrar
 * el estado contra la posición del sistema en el reporte mensual de conciliación.
 */
export const bankStatements = pgTable(
  'bank_statements',
  {
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
    /** Código del banco de origen (espejo de `bank_accounts.banco`). */
    banco: text('banco').notNull(),
    /** Versión del parser usado (los formatos de banco cambian → parsers versionados). */
    parserVersion: text('parser_version').notNull(),
    archivoNombre: text('archivo_nombre').notNull(),
    /** sha256 del archivo (idempotencia: re-importar el mismo archivo es no-op). */
    hashArchivo: text('hash_archivo').notNull(),
    desde: date('desde'),
    hasta: date('hasta'),
    saldoInicial: numeric('saldo_inicial', { precision: 20, scale: 8 }),
    saldoFinal: numeric('saldo_final', { precision: 20, scale: 8 }),
    importadoPor: uuid('importado_por').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('bank_statements_company_hash_uq').on(t.companyId, t.hashArchivo)],
);
