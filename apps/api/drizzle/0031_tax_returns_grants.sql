-- P10 — GRANTs de declaraciones al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede INSERT (crear borrador / presentar) y SELECT (consultar). La inmutabilidad de lo
-- PRESENTADA la impone el trigger de 0030 (cualquier UPDATE/DELETE sobre PRESENTADA se aborta). Se
-- conceden U/D por simetría operativa (un BORRADOR es editable); sobre lo presentado el trigger los
-- rechaza.

GRANT SELECT, INSERT, UPDATE, DELETE ON "tax_returns" TO contave_app;
