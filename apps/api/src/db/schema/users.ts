import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `users` — identidad global. Un usuario puede pertenecer a varios tenants (el caso del
 * contador con cartera), por eso NO es tenant-scoped: la relación usuario↔tenant vive en
 * `memberships`. Excepción intencional a la regla 12, igual que `tenants`.
 *
 * `password_hash` es nullable en P2: la autenticación (Argon2 + 2FA, docs/05 §6) llega en la
 * fase de seguridad. Datos sensibles se cifran at-rest en su momento (regla 14).
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  nombre: text('nombre').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
