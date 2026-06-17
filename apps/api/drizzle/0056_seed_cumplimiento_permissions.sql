-- P17 — Permisos RBAC de cumplimiento (regla 13: permiso a nivel de acción) y semilla de la versión
-- del producto. Idempotente. Providencia 121: la bitácora fiscal, la cola de remisión, el informe de
-- cumplimiento y el expediente técnico son material de auditoría/homologación → los consulta quien
-- audita o lleva la contabilidad; procesar la remisión y registrar la versión son acciones de gestión.

INSERT INTO "permissions" ("code", "descripcion") VALUES
  ('cumplimiento.view',          'Consultar la bitácora fiscal, el informe de cumplimiento y el expediente técnico'),
  ('cumplimiento.evento',        'Registrar eventos fiscales de impresión/reimpresión/anulación'),
  ('cumplimiento.remision',      'Procesar la cola de remisión al SENIAT y reintentar envíos'),
  ('cumplimiento.expediente',    'Exportar el expediente técnico de homologación')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- owner/admin reciben todo por el CROSS JOIN de 0004; re-otorgar es idempotente.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('owner', 'cumplimiento.view'),
  ('owner', 'cumplimiento.evento'),
  ('owner', 'cumplimiento.remision'),
  ('owner', 'cumplimiento.expediente'),
  ('admin', 'cumplimiento.view'),
  ('admin', 'cumplimiento.evento'),
  ('admin', 'cumplimiento.remision'),
  ('admin', 'cumplimiento.expediente')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- contador: opera el cumplimiento (consulta, registra eventos, procesa remisión, exporta expediente).
-- auditor: solo lectura (bitácora, informe, expediente). cajero/vendedor sin acceso.
INSERT INTO "role_permissions" ("role_code", "permission_code") VALUES
  ('contador', 'cumplimiento.view'),
  ('contador', 'cumplimiento.evento'),
  ('contador', 'cumplimiento.remision'),
  ('contador', 'cumplimiento.expediente'),
  ('auditor',  'cumplimiento.view'),
  ('auditor',  'cumplimiento.expediente')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Semilla de la versión inicial del producto (req. 6: versionado formal). En DESARROLLO hasta que se
-- presente la solicitud de homologación (roadmap F3). Idempotente por la unicidad de "version".
INSERT INTO "product_versions" ("version", "changelog", "estado_homologacion", "vigente_desde", "notas") VALUES
  ('0.1.0',
   'ContaVE — capa gerencial y fiscal (P0–P17): ledger triple base, documentos fiscales inmutables, IVA/IGTF/retenciones, libros, nómina, portal del contador y módulo de cumplimiento Providencia 121.',
   'DESARROLLO',
   NULL,
   'Versión base del expediente de homologación SNAT/2024/000121. Pasa a SOLICITADA al presentar el trámite (roadmap F3).')
ON CONFLICT ("version") DO NOTHING;
