-- P31 — Permisos RBAC de los importadores de migración (regla 13: permiso a nivel de acción).
-- Idempotente. Importar maestros y saldos de un cliente que migra de otro sistema (Gálac/Profit/Excel)
-- es una acción privilegiada; ver plantillas y la vista previa en seco (dry-run) es lectura.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('migracion.importar', 'Importar terceros, ítems, CxC/CxP y saldos iniciales desde otro sistema (confirmar)'),
  ('migracion.ver',      'Descargar plantillas y previsualizar en seco (dry-run) una migración')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'migracion.importar'),
  ('owner', 'migracion.ver'),
  ('admin', 'migracion.importar'),
  ('admin', 'migracion.ver')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El contador (cartera multi-empresa) suele ejecutar la migración del cliente; el auditor solo la ve.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'migracion.importar'),
  ('contador', 'migracion.ver'),
  ('auditor',  'migracion.ver')
ON CONFLICT DO NOTHING;
