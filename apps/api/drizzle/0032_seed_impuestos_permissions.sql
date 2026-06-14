-- P10 — Permisos RBAC del módulo de impuestos (regla 13: permiso a nivel de acción). Idempotente.
-- Generar libros y planillas es lectura derivada; presentar una declaración congela un snapshot
-- inmutable (acto formal ante el SENIAT), por eso se separa como permiso propio.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('libro.view',         'Generar y exportar Libros de Compras/Ventas (PDF/Excel)'),
  ('declaracion.view',   'Ver planillas borrador (IVA/IGTF) y declaraciones presentadas'),
  ('declaracion.present', 'Marcar una declaración como presentada (snapshot inmutable)')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'libro.view'), ('owner', 'declaracion.view'), ('owner', 'declaracion.present'),
  ('admin', 'libro.view'), ('admin', 'declaracion.view'), ('admin', 'declaracion.present')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- El contador lleva libros y declara; el auditor solo consulta (lectura).
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'libro.view'), ('contador', 'declaracion.view'), ('contador', 'declaracion.present'),
  ('auditor',  'libro.view'), ('auditor', 'declaracion.view')
ON CONFLICT DO NOTHING;
