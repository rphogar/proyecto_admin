import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `password_reset_tokens` — recuperación de contraseña de UN SOLO USO (P27, docs/05 §6). Tabla
 * GLOBAL de identidad (sin RLS, como `users`): la recuperación ocurre sin sesión ni tenant. Solo
 * se guarda el HASH del token (nunca el valor en claro, que viaja en el enlace al correo).
 *
 * `used_at` marca el consumo: un token usado o expirado (`expires_at`) ya no vale. El endpoint de
 * solicitud responde siempre igual exista o no el email (anti-enumeración).
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('password_reset_user_idx').on(t.userId)],
);
