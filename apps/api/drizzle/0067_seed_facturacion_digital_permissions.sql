-- P24 — Permisos RBAC de factura digital (regla 13: permiso a nivel de acción). Idempotente.
-- Emitir una factura digital asigna el número de control digital y dispara la entrega; reprocesar la
-- cola es operación de caja/contabilidad; consultar la cola es material de diagnóstico/auditoría.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('facturacion-digital.emitir',  'Emitir una factura digital (asignar número de control digital y entregar)'),
  ('facturacion-digital.procesar','Reprocesar entregas/conservaciones digitales pendientes de la cola'),
  ('facturacion-digital.leer',    'Consultar la cola de entregas digitales')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'facturacion-digital.emitir'),
  ('owner', 'facturacion-digital.procesar'),
  ('owner', 'facturacion-digital.leer'),
  ('admin', 'facturacion-digital.emitir'),
  ('admin', 'facturacion-digital.procesar'),
  ('admin', 'facturacion-digital.leer')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- cajero/vendedor: emiten facturas digitales (venta por medios electrónicos). contador: reprocesa la
-- cola y consulta. auditor: solo lectura.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('cajero',   'facturacion-digital.emitir'),
  ('cajero',   'facturacion-digital.leer'),
  ('vendedor', 'facturacion-digital.emitir'),
  ('vendedor', 'facturacion-digital.leer'),
  ('contador', 'facturacion-digital.emitir'),
  ('contador', 'facturacion-digital.procesar'),
  ('contador', 'facturacion-digital.leer'),
  ('auditor',  'facturacion-digital.leer')
ON CONFLICT DO NOTHING;
