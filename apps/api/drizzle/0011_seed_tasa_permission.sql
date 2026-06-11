-- P4 — Permiso RBAC para la entrada manual de tasas (regla 13: permiso a nivel de acción).
-- Idempotente. El enforcement por endpoint llega con la capa de auth; aquí se cataloga.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('exchange_rate.manage', 'Registrar tasas de cambio manuales (entrada auditada)')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin ya reciben todos los permisos por el CROSS JOIN de 0004, pero ese seed ya corrió;
-- re-otorgar explícitamente owner/admin/contador es idempotente y deja el reparto al día.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner',    'exchange_rate.manage'),
  ('admin',    'exchange_rate.manage'),
  ('contador', 'exchange_rate.manage')
ON CONFLICT DO NOTHING;
