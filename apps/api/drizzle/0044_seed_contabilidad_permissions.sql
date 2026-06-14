-- P13 — Permisos RBAC de contabilidad (regla 13: permiso a nivel de acción). Idempotente.
-- La vista del contador (M6): plan de cuentas, asientos manuales, plantillas, reportes y el wizard
-- de cierre. El cierre y la reapertura del período son acciones sensibles (owner+contador); auditor
-- solo consulta. La aplicación cablea el enforcement; `reabrir` valida rol en servicio (caso 43).

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('contabilidad.view',             'Consultar plan, asientos, balance y estados financieros'),
  ('contabilidad.asiento_manual',   'Registrar asientos manuales balanceados'),
  ('contabilidad.plantillas',       'Crear/editar plantillas de contabilización versionadas'),
  ('contabilidad.cerrar_periodo',   'Ejecutar el wizard y cerrar el período mensual'),
  ('contabilidad.reabrir_periodo',  'Reabrir un período cerrado (con motivo auditado)')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'contabilidad.view'),
  ('owner', 'contabilidad.asiento_manual'),
  ('owner', 'contabilidad.plantillas'),
  ('owner', 'contabilidad.cerrar_periodo'),
  ('owner', 'contabilidad.reabrir_periodo'),
  ('admin', 'contabilidad.view'),
  ('admin', 'contabilidad.asiento_manual'),
  ('admin', 'contabilidad.plantillas'),
  ('admin', 'contabilidad.cerrar_periodo')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador lleva la contabilidad y el cierre mensual (M6), incluida la reapertura con motivo;
-- auditor solo consulta. cajero/vendedor no tienen acceso a la contabilidad.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'contabilidad.view'),
  ('contador', 'contabilidad.asiento_manual'),
  ('contador', 'contabilidad.plantillas'),
  ('contador', 'contabilidad.cerrar_periodo'),
  ('contador', 'contabilidad.reabrir_periodo'),
  ('auditor',  'contabilidad.view')
ON CONFLICT DO NOTHING;
