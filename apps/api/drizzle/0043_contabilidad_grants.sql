-- P13 — GRANTs de contabilidad al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede INSERT/SELECT/UPDATE/DELETE; la inmutabilidad de versiones HISTORICAS y cierres
-- CERRADOS la imponen los triggers de 0042. `posting_templates` necesita UPDATE legítimo (bump de
-- `version_actual` al versionar) y `cierres_mensuales` UPDATE legítimo (cierre y reapertura auditada).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "posting_templates", "posting_template_versions", "posting_template_lines",
  "manual_entry_attachments", "cierres_mensuales" TO contave_app;
