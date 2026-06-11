import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `tenants` — raíz de la jerarquía multi-tenant (`tenant → companies → branches`).
 *
 * Excepción intencional a la regla 12 de CLAUDE.md: esta tabla NO lleva `tenant_id` ni RLS
 * porque ES el tenant. El acceso se acota en la capa de aplicación vía `memberships`
 * (un usuario solo ve los tenants donde tiene membresía). Ver docs/05 §2.
 */
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  nombre: text('nombre').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
