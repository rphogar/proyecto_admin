import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `refresh_tokens` — sesión rotativa revocable (P27, docs/05 §6). Tabla GLOBAL de identidad (sin
 * RLS, como `users`): el refresh se emite/valida ANTES de elegir tenant. Solo se guarda el HASH
 * SHA-256 del token opaco (`token_hash`), nunca el valor en claro.
 *
 * Rotación: cada uso emite un par nuevo (misma `family_id`) y marca el anterior con `rotated_to`
 * (id del sucesor). Presentar un token ya rotado (`rotated_to` no nulo) o revocado (`revoked_at`)
 * es señal de robo → el `AuthService` revoca toda la `family_id`. Ver `auth/tokens-sesion.ts`.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedTo: uuid('rotated_to'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId), index('refresh_tokens_family_idx').on(t.familyId)],
);
