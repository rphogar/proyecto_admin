-- P8 — GRANTs de los cobros al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede INSERT (registrar) y SELECT (listar/ver); la inmutabilidad de lo POSTED la imponen
-- los triggers de 0022 (cualquier UPDATE/DELETE se aborta). Se conceden U/D por simetría operativa
-- (un cobro DRAFT futuro sería editable); sobre POSTED el trigger los rechaza.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "cobros", "cobro_medios", "cobro_aplicaciones" TO contave_app;
