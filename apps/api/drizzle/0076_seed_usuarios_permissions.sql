-- P29 — Permisos RBAC de gestión de usuarios (regla 13: permiso a nivel de acción). Idempotente.
-- La gestión (invitar, reasignar rol, activar/desactivar) y la lectura (visor de usuarios/roles/
-- permisos e invitaciones) son acciones separadas. La TRANSFERENCIA DE PROPIEDAD no es un permiso:
-- se restringe a `rol = 'owner'` en el servicio (sólo un owner cede la propiedad).

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('usuario.ver',       'Ver usuarios, roles, permisos e invitaciones del tenant'),
  ('usuario.gestionar', 'Invitar usuarios, reasignar roles y activar/desactivar membresías')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'usuario.ver'),
  ('owner', 'usuario.gestionar'),
  ('admin', 'usuario.ver'),
  ('admin', 'usuario.gestionar')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El auditor (solo lectura) ve el visor de usuarios/roles; contador/cajero/vendedor también pueden
-- consultar quién tiene acceso, pero NO gestionar.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('auditor',  'usuario.ver'),
  ('contador', 'usuario.ver'),
  ('cajero',   'usuario.ver'),
  ('vendedor', 'usuario.ver')
ON CONFLICT DO NOTHING;
