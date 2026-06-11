import { type AnyPgColumn, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { periods } from './periods';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `journal_entries` — cabecera de asiento contable (docs/05 §3.5). Tenant-scoped → RLS.
 *
 * Inmutabilidad (regla 4 de CLAUDE.md): los asientos POSTED no admiten UPDATE/DELETE; lo hace
 * cumplir el trigger `journal_entries_inmutable` (migración 0006) además del rol de aplicación.
 * El reverso es un asiento NUEVO con `reversal_of` → original (decisión de diseño acordada): el
 * original nunca se modifica; "reversado" se DERIVA de la existencia del reverso. Por eso
 * `estado` solo admite DRAFT|POSTED (CHECK en 0006), sin transición a REVERSED.
 *
 * `fecha` es el instante (UTC); la fecha fiscal y el período se derivan en hora de Caracas
 * (regla 15). El invariante ΣD=ΣC en las tres bases se valida con un CHECK DIFERIDO por asiento
 * (constraint trigger en 0006), evaluado al COMMIT.
 */
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Instante del asiento (UTC). La fecha fiscal y el período se derivan en Caracas. */
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  periodId: uuid('period_id')
    .notNull()
    .references(() => periods.id),
  /** DRAFT | POSTED (CHECK en 0006). REVERSED se deriva, no se persiste. */
  estado: text('estado').notNull().default('DRAFT'),
  /** Tipo de documento/origen que generó el asiento (FACTURA, PAGO, NOMINA, MANUAL…). */
  sourceType: text('source_type'),
  sourceId: uuid('source_id'),
  /** Si es un asiento de reverso: id del asiento original (self-FK). */
  reversalOf: uuid('reversal_of').references((): AnyPgColumn => journalEntries.id),
  descripcion: text('descripcion').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
