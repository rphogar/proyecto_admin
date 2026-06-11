-- P3 — GRANTs del ledger al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- La inmutabilidad de los asientos POSTED la imponen los triggers de 0006 (el rol puede intentar
-- UPDATE/DELETE, pero el trigger lo aborta), igual que con audit_events.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "accounts", "periods", "journal_entries", "journal_lines" TO contave_app;
