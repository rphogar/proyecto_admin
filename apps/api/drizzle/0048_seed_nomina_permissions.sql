-- P15 — Permisos RBAC de nómina (regla 13: permiso a nivel de acción). Idempotente.
-- Complementa los permisos `payroll.create`/`payroll.approve`/`salary.read` ya sembrados en 0004.
-- La vista del contador (M8): fichas, conceptos, corridas (pre-nómina→aprobación→contabilización),
-- prestaciones/liquidación, provisiones, parafiscales y ARI/ARC. El auditor solo consulta;
-- cajero/vendedor no acceden a la nómina. La aplicación cablea el enforcement con los guards.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('nomina.view',          'Consultar nómina, recibos, prestaciones y reportes'),
  ('nomina.trabajadores',  'Gestionar fichas de trabajadores'),
  ('nomina.conceptos',     'Gestionar conceptos y fórmulas de nómina'),
  ('nomina.calcular',      'Crear y preparar pre-nóminas'),
  ('nomina.aprobar',       'Aprobar y contabilizar corridas de nómina'),
  ('nomina.prestaciones',  'Gestionar kardex de prestaciones y liquidaciones (art. 142)'),
  ('nomina.provisiones',   'Generar provisiones mensuales de pasivos laborales'),
  ('nomina.parafiscales',  'Generar planillas parafiscales (TIUNA/FAOV/INCES)'),
  ('nomina.ari_arc',       'Gestionar AR-I y emitir certificados ARC')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'nomina.view'),
  ('owner', 'nomina.trabajadores'),
  ('owner', 'nomina.conceptos'),
  ('owner', 'nomina.calcular'),
  ('owner', 'nomina.aprobar'),
  ('owner', 'nomina.prestaciones'),
  ('owner', 'nomina.provisiones'),
  ('owner', 'nomina.parafiscales'),
  ('owner', 'nomina.ari_arc'),
  ('admin', 'nomina.view'),
  ('admin', 'nomina.trabajadores'),
  ('admin', 'nomina.conceptos'),
  ('admin', 'nomina.calcular'),
  ('admin', 'nomina.aprobar'),
  ('admin', 'nomina.prestaciones'),
  ('admin', 'nomina.provisiones'),
  ('admin', 'nomina.parafiscales'),
  ('admin', 'nomina.ari_arc')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador lleva la nómina completa (M8); auditor solo consulta. cajero/vendedor sin acceso.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'nomina.view'),
  ('contador', 'nomina.trabajadores'),
  ('contador', 'nomina.conceptos'),
  ('contador', 'nomina.calcular'),
  ('contador', 'nomina.aprobar'),
  ('contador', 'nomina.prestaciones'),
  ('contador', 'nomina.provisiones'),
  ('contador', 'nomina.parafiscales'),
  ('contador', 'nomina.ari_arc'),
  ('auditor',  'nomina.view')
ON CONFLICT DO NOTHING;
