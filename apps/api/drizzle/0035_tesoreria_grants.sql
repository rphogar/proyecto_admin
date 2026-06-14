-- P11 — GRANTs de tesorería al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede INSERT/SELECT/UPDATE/DELETE; la inmutabilidad de lo POSTED/CERRADO la imponen los
-- triggers de 0034 (cualquier UPDATE/DELETE sobre esas filas se aborta). `statement_lines` y
-- `reconciliations` necesitan UPDATE legítimo (cambian de estado al conciliar).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "bank_accounts", "bank_statements", "statement_lines", "transferencias",
  "cierres_caja", "cierre_caja_arqueos", "reconciliations", "revaluaciones" TO contave_app;
