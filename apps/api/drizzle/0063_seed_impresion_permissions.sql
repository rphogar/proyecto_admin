-- P23 — Permisos RBAC de impresión fiscal (regla 13: permiso a nivel de acción). Idempotente.
-- El agente local actúa con credenciales del tenant para reclamar trabajos e informar el resultado;
-- los reportes X/Z y la lectura de memoria fiscal son operación de caja/contabilidad; la consulta de
-- la cola es material de diagnóstico/auditoría.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('impresion.reclamar',  'Reclamar trabajos de impresión de la cola de la máquina fiscal (agente local)'),
  ('impresion.reportar',  'Reportar el resultado de impresión de un trabajo (agente local)'),
  ('impresion.reporte',   'Emitir reportes fiscales X y Z en la máquina fiscal'),
  ('impresion.leer',      'Leer la memoria fiscal y consultar la cola de impresión')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'impresion.reclamar'),
  ('owner', 'impresion.reportar'),
  ('owner', 'impresion.reporte'),
  ('owner', 'impresion.leer'),
  ('admin', 'impresion.reclamar'),
  ('admin', 'impresion.reportar'),
  ('admin', 'impresion.reporte'),
  ('admin', 'impresion.leer')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- cajero: opera el POS y la máquina fiscal (reclama/reporta vía agente, emite X/Z). contador: emite
-- reportes y lee la memoria fiscal/cola. auditor: solo lectura de la cola/memoria. vendedor sin acceso.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('cajero',   'impresion.reclamar'),
  ('cajero',   'impresion.reportar'),
  ('cajero',   'impresion.reporte'),
  ('cajero',   'impresion.leer'),
  ('contador', 'impresion.reporte'),
  ('contador', 'impresion.leer'),
  ('auditor',  'impresion.leer')
ON CONFLICT DO NOTHING;
