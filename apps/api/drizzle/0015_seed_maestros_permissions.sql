-- P5 — Permisos RBAC de los maestros (regla 13: permiso a nivel de acción). Idempotente.
-- `party.manage` e `item.manage` ya existen del seed 0004; aquí se agregan los maestros restantes
-- y se reparten a los roles que gestionan configuración comercial. El enforcement por endpoint
-- llega con la capa de auth; aquí se cataloga.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('warehouse.manage',      'Gestionar almacenes'),
  ('price_list.manage',     'Gestionar listas de precios'),
  ('payment_method.manage', 'Gestionar métodos de pago y su mapeo contable'),
  ('series.manage',         'Gestionar series de documentos')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todos los permisos por el CROSS JOIN de 0004, pero ese seed ya corrió:
-- re-otorgar explícitamente es idempotente y deja el reparto al día.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'warehouse.manage'),
  ('owner', 'price_list.manage'),
  ('owner', 'payment_method.manage'),
  ('owner', 'series.manage'),
  ('admin', 'warehouse.manage'),
  ('admin', 'price_list.manage'),
  ('admin', 'payment_method.manage'),
  ('admin', 'series.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador: configura mapeo contable de métodos de pago y series (cumplimiento fiscal).
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'payment_method.manage'),
  ('contador', 'series.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- vendedor: maestros comerciales (ya tiene party.manage e item.manage del 0004) + listas de precios.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('vendedor', 'price_list.manage')
ON CONFLICT DO NOTHING;
