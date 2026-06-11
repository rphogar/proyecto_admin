import { inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `audit_events` — bitácora append-only (reglas 5 de CLAUDE.md, Providencia 121).
 *
 * Toda operación de escritura registra: quién (`actor_user_id`), cuándo (UTC + hora legal de
 * Venezuela), qué (`accion`, `entidad`, `entidad_id`), valores antes/después, IP y device.
 * Tenant-scoped → RLS. La inmutabilidad se hace cumplir en DOS capas (migraciones
 * `0003_audit_append_only` + `0004_grants`): el rol de aplicación NO recibe UPDATE/DELETE y
 * un trigger `BEFORE UPDATE OR DELETE` aborta cualquier intento aunque alguien salte la app.
 */
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Usuario que ejecuta la acción. Nullable para eventos de sistema/jobs. */
  actorUserId: uuid('actor_user_id').references(() => users.id),
  /** Acción de dominio: 'company.create', 'period.close', 'membership.update', … */
  accion: text('accion').notNull(),
  /** Tabla/entidad afectada: 'companies', 'memberships', … */
  entidad: text('entidad').notNull(),
  entidadId: uuid('entidad_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  /** Instante de la acción en UTC (verdad de almacenamiento, regla 15). */
  tsUtc: timestamp('ts_utc', { withTimezone: true }).defaultNow().notNull(),
  /** Misma marca en hora legal de Venezuela (ISO con offset −04:00), derivada con shared. */
  tsCaracas: text('ts_caracas').notNull(),
  ip: inet('ip'),
  device: text('device'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
