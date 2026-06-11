import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Catálogo RBAC (regla 13 de CLAUDE.md): roles y permisos a nivel de ACCIÓN, no de pantalla.
 *
 * Es un catálogo GLOBAL (no tenant-scoped): los códigos de rol/permiso son los mismos para
 * todo el SaaS; lo que varía por tenant es la asignación, que vive en `memberships.role`.
 * Se siembra en la migración `0005_seed_rbac`. El enforcement por endpoint llega en la fase
 * de seguridad; P2 solo establece el catálogo y la referencia desde `memberships`.
 */
export const roles = pgTable('roles', {
  code: text('code').primaryKey(),
  descripcion: text('descripcion').notNull(),
});

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  descripcion: text('descripcion').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleCode: text('role_code')
      .notNull()
      .references(() => roles.code, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);
