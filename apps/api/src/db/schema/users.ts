import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `users` — identidad global. Un usuario puede pertenecer a varios tenants (el caso del
 * contador con cartera), por eso NO es tenant-scoped: la relación usuario↔tenant vive en
 * `memberships`. Excepción intencional a la regla 12, igual que `tenants`.
 *
 * `password_hash` es nullable en P2: la autenticación (Argon2 + 2FA, docs/05 §6) llega en la
 * fase de seguridad. Datos sensibles se cifran at-rest en su momento (regla 14).
 *
 * 2FA TOTP (P18, docs/05 §6): obligatorio para owner/admin/contador. El secreto se guarda
 * **cifrado at-rest** (AES-256-GCM, `seguridad/cifrado.ts`); `totp_enabled` pasa a true al
 * confirmar el enrolamiento con un código válido (`totp_confirmed_at`).
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  nombre: text('nombre').notNull(),
  status: text('status').notNull().default('active'),
  /**
   * Email verificado (P29). Se pone true al aceptar una invitación (el clic en el enlace prueba
   * control del buzón) y la migración 0074 marca true a todos los usuarios preexistentes. Deja
   * listo el dato para activar el gate del login (`TODO(verificacion-email)` en `auth.service.ts`);
   * activarlo exige primero sembrar `email_verified=true` en `seed-demo` para no romper el demo.
   */
  emailVerified: boolean('email_verified').notNull().default(false),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
