-- P9 — Permisos RBAC de compras y retenciones (regla 13: permiso a nivel de acción). Idempotente.
-- Registrar una compra genera asiento y crédito fiscal; emitir un comprobante de retención crea un
-- pasivo por enterar inalterable; registrar un comprobante recibido aplica un crédito a la cuota.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('compra.create',          'Registrar facturas de compra (genera asiento y crédito fiscal)'),
  ('compra.view',            'Consultar compras'),
  ('retencion.issue',        'Emitir comprobantes de retención (IVA/ISLR) como agente'),
  ('retencion.receive',      'Registrar comprobantes de retención recibidos'),
  ('retencion.view',         'Consultar retenciones y exportar TXT/comprobantes')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'compra.create'), ('owner', 'compra.view'),
  ('owner', 'retencion.issue'), ('owner', 'retencion.receive'), ('owner', 'retencion.view'),
  ('admin', 'compra.create'), ('admin', 'compra.view'),
  ('admin', 'retencion.issue'), ('admin', 'retencion.receive'), ('admin', 'retencion.view')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El contador lleva compras y retenciones; el auditor solo consulta. El cajero/vendedor no compran.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'compra.create'), ('contador', 'compra.view'),
  ('contador', 'retencion.issue'), ('contador', 'retencion.receive'), ('contador', 'retencion.view'),
  ('auditor',  'compra.view'), ('auditor', 'retencion.view')
ON CONFLICT DO NOTHING;
