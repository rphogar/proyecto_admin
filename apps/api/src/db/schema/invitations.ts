import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { roles } from './rbac';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `invitations` — invitación de un usuario a un tenant con un rol (P29, docs/05 §6, docs/06 M12).
 * Va **por email** (no como `membership` pendiente) porque el invitado puede aún no tener `user`, y
 * `memberships` exige `user_id NOT NULL` + `unique(tenant_id, user_id)`. Al ACEPTAR se crea/vincula
 * el `user` y recién ahí se inserta la `membership` activa.
 *
 * Tenant-scoped → RLS (`0074`): la administración (crear/listar/revocar) se acota al tenant. La
 * ACEPTACIÓN es PRE-tenant (el invitado no tiene tenant aún): se resuelve por `token_hash` con una
 * función `SECURITY DEFINER` (`invitacion_por_token`), igual que el login resuelve identidad antes
 * de fijar tenant. El secreto va HASHEADO (SHA-256), nunca en claro (como `password_reset_tokens`).
 *
 * Un índice parcial único `(tenant_id, lower(email)) WHERE estado='pending'` (en `0074`) garantiza
 * a lo sumo UNA invitación viva por email/tenant.
 */
export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Email invitado, normalizado a minúsculas. */
  email: text('email').notNull(),
  role: text('role')
    .notNull()
    .references(() => roles.code),
  /** Hash SHA-256 del token opaco de invitación (el valor en claro solo viaja por correo/dev). */
  tokenHash: text('token_hash').notNull().unique(),
  /** pending | accepted | revoked | expired (CHECK en 0074). */
  estado: text('estado').notNull().default('pending'),
  invitedBy: uuid('invited_by').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  /** Usuario que terminó aceptando (creado o vinculado). */
  acceptedUserId: uuid('accepted_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
