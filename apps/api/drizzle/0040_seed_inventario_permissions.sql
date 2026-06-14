-- P12 — Permisos RBAC de inventario (regla 13: permiso a nivel de acción). Idempotente.
-- El ajuste tiene dos acciones separadas (crear vs aprobar) por separación de deberes (caso 40):
-- quien registra la merma no es quien la aprueba.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('inventario.view',          'Consultar existencias, kardex y costos'),
  ('inventario.ajuste',        'Registrar ajustes de inventario (quedan PENDIENTES de aprobación)'),
  ('inventario.ajuste_aprobar','Aprobar ajustes de inventario (genera movimiento y asiento)'),
  ('inventario.traslado',      'Despachar y recibir traslados entre almacenes'),
  ('inventario.conteo',        'Abrir y cerrar conteos físicos'),
  ('inventario.precios',       'Actualizar precios masivamente (listas de precios)')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'inventario.view'),
  ('owner', 'inventario.ajuste'),
  ('owner', 'inventario.ajuste_aprobar'),
  ('owner', 'inventario.traslado'),
  ('owner', 'inventario.conteo'),
  ('owner', 'inventario.precios'),
  ('admin', 'inventario.view'),
  ('admin', 'inventario.ajuste'),
  ('admin', 'inventario.ajuste_aprobar'),
  ('admin', 'inventario.traslado'),
  ('admin', 'inventario.conteo'),
  ('admin', 'inventario.precios')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador supervisa costos/valuación y aprueba ajustes (incidencia contable); el vendedor opera
-- traslados/conteos y consulta; el cajero consulta existencias; el auditor solo lee.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'inventario.view'),
  ('contador', 'inventario.ajuste'),
  ('contador', 'inventario.ajuste_aprobar'),
  ('contador', 'inventario.conteo'),
  ('contador', 'inventario.precios'),
  ('vendedor', 'inventario.view'),
  ('vendedor', 'inventario.ajuste'),
  ('vendedor', 'inventario.traslado'),
  ('vendedor', 'inventario.conteo'),
  ('cajero',   'inventario.view'),
  ('auditor',  'inventario.view')
ON CONFLICT DO NOTHING;
