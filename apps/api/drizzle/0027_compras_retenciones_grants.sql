-- P9 — GRANTs de compras y retenciones al rol de aplicación `contave_app` (decisión P2: rol sin
-- BYPASSRLS). El rol puede INSERT (registrar) y SELECT (listar/ver/declarar). La inmutabilidad de lo
-- REGISTERED y de los comprobantes la imponen los triggers de 0026 (cualquier UPDATE/DELETE se
-- aborta). Se conceden U/D por simetría operativa (un DRAFT de compra futuro sería editable); sobre
-- lo inmutable el trigger los rechaza.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "purchases", "purchase_lines", "purchase_taxes", "retentions_issued", "retentions_received"
  TO contave_app;
