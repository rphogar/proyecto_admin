-- P30 — Permisos RBAC del onboarding (regla 13: permiso a nivel de acción). Idempotente.
-- Dar de alta una empresa y precargar su configuración es una acción privilegiada (owner/admin);
-- ver el estado del asistente es lectura.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('empresa.crear', 'Dar de alta una empresa: inferir perfil, precargar configuración y registrar saldos de apertura'),
  ('empresa.ver',   'Ver empresas y el estado del asistente de onboarding')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'empresa.crear'),
  ('owner', 'empresa.ver'),
  ('admin', 'empresa.crear'),
  ('admin', 'empresa.ver')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El contador (cartera multi-empresa) y el auditor (solo lectura) pueden ver el estado de alta; no
-- crean empresas (eso lo hace el dueño/admin).
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'empresa.ver'),
  ('auditor',  'empresa.ver')
ON CONFLICT DO NOTHING;
