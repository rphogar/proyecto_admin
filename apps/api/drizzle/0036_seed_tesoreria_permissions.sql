-- P11 — Permisos RBAC de tesorería (regla 13: permiso a nivel de acción). Idempotente.
-- Tesorería toca caja, bancos y asientos: acciones sensibles separadas por responsabilidad.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('tesoreria.view',          'Consultar posición, movimientos y conciliación'),
  ('tesoreria.transfer',      'Registrar transferencias internas (genera asiento y diferencial)'),
  ('tesoreria.cierre_caja',   'Abrir y cerrar caja con arqueo por método'),
  ('tesoreria.importar',      'Importar estados de cuenta bancarios'),
  ('tesoreria.conciliar',     'Conciliar movimientos banco ⇄ sistema'),
  ('tesoreria.revaluar',      'Ejecutar la revaluación mensual de saldos en divisas')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'tesoreria.view'),
  ('owner', 'tesoreria.transfer'),
  ('owner', 'tesoreria.cierre_caja'),
  ('owner', 'tesoreria.importar'),
  ('owner', 'tesoreria.conciliar'),
  ('owner', 'tesoreria.revaluar'),
  ('admin', 'tesoreria.view'),
  ('admin', 'tesoreria.transfer'),
  ('admin', 'tesoreria.cierre_caja'),
  ('admin', 'tesoreria.importar'),
  ('admin', 'tesoreria.conciliar'),
  ('admin', 'tesoreria.revaluar')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador supervisa tesorería y maneja la conciliación/revaluación (cierre mensual M6); cajero opera
-- caja (cierre de turno) y ve la posición; auditor solo consulta.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'tesoreria.view'),
  ('contador', 'tesoreria.transfer'),
  ('contador', 'tesoreria.cierre_caja'),
  ('contador', 'tesoreria.importar'),
  ('contador', 'tesoreria.conciliar'),
  ('contador', 'tesoreria.revaluar'),
  ('cajero',   'tesoreria.view'),
  ('cajero',   'tesoreria.cierre_caja'),
  ('auditor',  'tesoreria.view')
ON CONFLICT DO NOTHING;
