-- P16 — Permisos RBAC del portal del contador (regla 13: permiso a nivel de acción). Idempotente.
-- M11: el panel multi-empresa con estado de cierres, el calendario consolidado de obligaciones y el
-- checklist masivo de cierre son de consulta (`portal.view`); otorgar/revocar delegaciones de permisos
-- por empresa es una acción del dueño/admin (`portal.delegar`). La aplicación cablea el enforcement
-- con los guards de auth.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('portal.view',    'Acceder al portal del contador (panel multi-empresa, calendario, checklist)'),
  ('portal.delegar', 'Otorgar y revocar delegaciones de permisos por empresa')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'portal.view'),
  ('owner', 'portal.delegar'),
  ('admin', 'portal.view'),
  ('admin', 'portal.delegar')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El contador gestiona la cartera desde el portal (lo consulta); el auditor solo consulta. Delegar
-- es prerrogativa del dueño/admin de cada empresa, no del contador. cajero/vendedor sin acceso.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'portal.view'),
  ('auditor',  'portal.view')
ON CONFLICT DO NOTHING;
