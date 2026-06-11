import {
  type AnyPgColumn,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `exchange_rates` — tasas de cambio (P4, docs/05 §3.3, reglas 1, 2, 4, 5, 17 de CLAUDE.md).
 *
 * Modelo de alcance HÍBRIDO: `tenant_id` es nullable. `NULL` = tasa global del BCV (la inserta
 * el job diario; visible para todos los tenants); no-null = entrada manual o de mercado propia
 * del tenant. La RLS combina ambas: `tenant_id IS NULL OR tenant_id = app_current_tenant()`
 * (migración `0009`). Esto evita duplicar la tasa nacional por tenant y a la vez permite
 * overrides locales.
 *
 * `rate` en `NUMERIC(20,8)` con la precisión exacta publicada por el BCV (regla 1/2). La tasa
 * se congela por documento vía `exchange_rate_id` (regla 2): aquí NUNCA se sobreescribe una
 * fila ya usada — la tabla es **append-only** (GRANT sin UPDATE/DELETE + trigger en `0009`,
 * igual filosofía que `audit_events`). Una corrección del BCV (caso 3) entra como fila NUEVA
 * que apunta a la corregida con `reemplaza_a`; `rateFor` resuelve por `rate_date` y `captured_at`.
 *
 * Idempotencia del job: índice único `(tenant_id, currency, rate_date, source, rate)` con
 * `NULLS NOT DISTINCT` (migración `0009`) → re-correr con la misma tasa es `ON CONFLICT DO NOTHING`.
 */
export const exchangeRates = pgTable('exchange_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** NULL = tasa global BCV; no-null = entrada propia del tenant (MANUAL/MARKET). */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** Moneda extranjera valuada contra VES: 'USD' | 'EUR' (CHECK en 0009). */
  currency: text('currency').notNull(),
  /** Tasa VES por unidad de `currency`, precisión BCV (regla 1). */
  rate: numeric('rate', { precision: 20, scale: 8 }).notNull(),
  /** Fecha de vigencia (fecha civil en Caracas, regla 15). */
  rateDate: date('rate_date').notNull(),
  /** Origen: 'BCV' | 'MANUAL' | 'MARKET' (CHECK en 0009). */
  source: text('source').notNull(),
  /** Cuándo lo capturó el sistema (desempata correcciones del mismo día). */
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  /** Cuándo lo publicó la fuente (BCV), si se conoce. */
  publishedAt: timestamp('published_at', { withTimezone: true }),
  /** Huella del payload de origen (idempotencia/auditoría de la captura). */
  hashFuente: text('hash_fuente'),
  /** Corrección (caso 3): apunta a la fila que esta tasa reemplaza. */
  reemplazaA: uuid('reemplaza_a').references((): AnyPgColumn => exchangeRates.id),
  /** Motivo de una entrada MANUAL (entrada auditada). */
  motivo: text('motivo'),
  /** Actor de una entrada MANUAL (NULL en capturas del job). */
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
