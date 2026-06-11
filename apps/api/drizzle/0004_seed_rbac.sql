-- P2 — Catálogo RBAC base (regla 13 de CLAUDE.md). Idempotente (ON CONFLICT DO NOTHING).
-- El enforcement por endpoint llega en la fase de seguridad; aquí se establece el catálogo
-- y el reparto inicial de permisos por rol.

INSERT INTO "roles" ("code", "descripcion") VALUES
  ('owner',    'Dueño del tenant; control total'),
  ('admin',    'Administrador; gestión completa salvo transferencia de propiedad'),
  ('contador', 'Contador; contabilidad, impuestos y nómina'),
  ('cajero',   'Cajero; emisión de documentos y registro de cobros'),
  ('vendedor', 'Vendedor; emisión de documentos y maestros comerciales'),
  ('auditor',  'Auditor; solo lectura')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('document.issue',       'Emitir documentos fiscales'),
  ('document.read',        'Consultar documentos'),
  ('document.cancel',      'Anular documentos pre-emisión'),
  ('payment.register',     'Registrar cobros y pagos'),
  ('period.close',         'Cerrar períodos contables'),
  ('period.reopen',        'Reabrir períodos contables'),
  ('payroll.create',       'Crear corridas de nómina'),
  ('payroll.approve',      'Aprobar corridas de nómina'),
  ('salary.read',          'Ver salarios y datos sensibles de nómina'),
  ('party.manage',         'Gestionar terceros (clientes/proveedores)'),
  ('item.manage',          'Gestionar ítems y precios'),
  ('company.manage',       'Gestionar empresas y sucursales'),
  ('fiscal_param.manage',  'Gestionar parámetros normativos con vigencia'),
  ('tax_return.file',      'Preparar y presentar declaraciones'),
  ('audit.read',           'Consultar la bitácora de auditoría')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner y admin: todos los permisos.
INSERT INTO "role_permissions" ("role_code", "permission_code")
  SELECT r.code, p.code FROM (VALUES ('owner'), ('admin')) AS r(code)
  CROSS JOIN "permissions" p
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador: contabilidad, impuestos, nómina y lectura.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'document.read'),
  ('contador', 'period.close'),
  ('contador', 'period.reopen'),
  ('contador', 'payroll.create'),
  ('contador', 'payroll.approve'),
  ('contador', 'salary.read'),
  ('contador', 'fiscal_param.manage'),
  ('contador', 'tax_return.file'),
  ('contador', 'audit.read'),
  ('contador', 'payment.register')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- cajero: emisión y cobros.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('cajero', 'document.issue'),
  ('cajero', 'document.read'),
  ('cajero', 'payment.register')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- vendedor: emisión y maestros comerciales.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('vendedor', 'document.issue'),
  ('vendedor', 'document.read'),
  ('vendedor', 'party.manage'),
  ('vendedor', 'item.manage')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- auditor: solo lectura.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('auditor', 'document.read'),
  ('auditor', 'salary.read'),
  ('auditor', 'audit.read')
ON CONFLICT DO NOTHING;
