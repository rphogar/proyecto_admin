-- P6 — Permisos RBAC de documentos (regla 13: permiso a nivel de acción). Idempotente.
-- La emisión es una acción sensible (genera correlativo fiscal, asiento y evento inalterable):
-- `document.issue`. La gestión del borrador y la anulación pre-emisión se separan. El enforcement
-- por endpoint llega con la capa de auth; aquí se cataloga y reparte.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('document.manage', 'Crear y editar borradores de documentos'),
  ('document.issue',  'Emitir documentos fiscales (asigna correlativo y genera asiento)'),
  ('document.cancel', 'Anular un documento en borrador (pre-emisión)')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todos los permisos por el CROSS JOIN de 0004, pero ese seed ya corrió:
-- re-otorgar explícitamente es idempotente y deja el reparto al día.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'document.manage'),
  ('owner', 'document.issue'),
  ('owner', 'document.cancel'),
  ('admin', 'document.manage'),
  ('admin', 'document.issue'),
  ('admin', 'document.cancel')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- vendedor y cajero emiten en el día a día (ventas/facturación al detal); contador supervisa.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('vendedor', 'document.manage'),
  ('vendedor', 'document.issue'),
  ('vendedor', 'document.cancel'),
  ('cajero',   'document.manage'),
  ('cajero',   'document.issue'),
  ('contador', 'document.manage'),
  ('contador', 'document.issue'),
  ('contador', 'document.cancel')
ON CONFLICT DO NOTHING;
