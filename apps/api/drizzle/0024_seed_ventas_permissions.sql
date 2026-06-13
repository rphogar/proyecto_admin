-- P8 — Permisos RBAC de cobros (regla 13: permiso a nivel de acción). Idempotente.
-- El cobro es una acción sensible (genera asiento e IGTF percibido inalterable): `cobro.create`.
-- La emisión de facturas y NC/ND ya está cubierta por `document.issue`/`document.manage` (0019).

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('cobro.create', 'Registrar cobros (genera asiento, IGTF y diferencial)'),
  ('cobro.view',   'Consultar cobros')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'cobro.create'),
  ('owner', 'cobro.view'),
  ('admin', 'cobro.create'),
  ('admin', 'cobro.view')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- cajero/vendedor cobran en el día a día; contador supervisa; auditor solo consulta.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('cajero',   'cobro.create'),
  ('cajero',   'cobro.view'),
  ('vendedor', 'cobro.create'),
  ('vendedor', 'cobro.view'),
  ('contador', 'cobro.create'),
  ('contador', 'cobro.view'),
  ('auditor',  'cobro.view')
ON CONFLICT DO NOTHING;
