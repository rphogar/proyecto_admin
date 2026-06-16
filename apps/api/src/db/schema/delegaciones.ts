import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `delegaciones` — permisos que el dueño de una empresa delega a otro usuario (típicamente su
 * contador) para operar esa empresa dentro del portal multi-empresa (P16, docs/06 M11). Es el
 * motor del modelo de distribución: el contador con cartera gestiona varias `companies` del tenant
 * y cada dueño le concede, por empresa, un subconjunto de acciones (regla 13: permisos a nivel de
 * acción, no de pantalla). Tenant-scoped → RLS.
 *
 * `permisos` es un arreglo jsonb de códigos de permiso (catálogo `permissions`). Una sola delegación
 * vigente por (empresa, usuario) — `unique` — que se reotorga con UPSERT y se retira marcando
 * `estado='REVOCADA'` (no se borra: conserva la traza de quién delegó/revocó y cuándo). El
 * enforcement por endpoint lo cablean los guards de auth (regla 13); aquí se modela el otorgamiento.
 */
export const delegaciones = pgTable(
  'delegaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Usuario que recibe la delegación (el contador de la cartera). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Arreglo de códigos de permiso delegados (subconjunto del catálogo `permissions`). */
    permisos: jsonb('permisos').notNull(),
    /** ACTIVA | REVOCADA (CHECK en 0050). */
    estado: text('estado').notNull().default('ACTIVA'),
    /** Dueño/admin que otorgó la delegación (para la auditoría). */
    otorgadoPor: uuid('otorgado_por').references(() => users.id),
    revokedBy: uuid('revoked_by').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('delegaciones_company_user_uq').on(t.companyId, t.userId)],
);
