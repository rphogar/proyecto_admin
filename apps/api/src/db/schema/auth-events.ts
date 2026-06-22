import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `auth_events` — bitácora **append-only** de identidad (P27). Contraparte pre-tenant de
 * `audit_events`: el login ocurre antes de elegir tenant, por eso este registro es GLOBAL (sin RLS)
 * y sin UPDATE/DELETE concedidos a la app (regla 5). Registra el quién/cuándo/desde-dónde de los
 * eventos de autenticación, incluyendo intentos contra emails inexistentes (`user_id` nulo).
 *
 * El "cuándo" se guarda en UTC (`ts_utc`) y en hora legal de Venezuela (`ts_caracas`), como en
 * `audit_events` (regla 15).
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    emailIntentado: text('email_intentado'),
    tipo: text('tipo').notNull(),
    ip: text('ip'),
    device: text('device'),
    tsUtc: timestamp('ts_utc', { withTimezone: true }).notNull(),
    tsCaracas: text('ts_caracas').notNull(),
    metadata: jsonb('metadata'),
  },
  (t) => [index('auth_events_user_idx').on(t.userId), index('auth_events_tipo_idx').on(t.tipo)],
);
