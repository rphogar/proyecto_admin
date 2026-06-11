import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { roles } from './rbac';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `memberships` — vínculo usuario↔tenant con su rol (regla 13). Tenant-scoped: lleva
 * `tenant_id` y queda bajo RLS (migración `0002_rls`). Un usuario tiene a lo sumo una
 * membresía por tenant (`unique(tenant_id, user_id)`).
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role')
      .notNull()
      .references(() => roles.code),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('memberships_tenant_user_uq').on(t.tenantId, t.userId)],
);
