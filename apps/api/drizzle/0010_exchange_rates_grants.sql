-- P4 — GRANTs de exchange_rates al rol de aplicación `contave_app` (decisión P2: rol sin
-- BYPASSRLS). Append-only como `audit_events`: SELECT + INSERT, SIN UPDATE/DELETE (reglas 4/5).
-- La inmutabilidad la refuerza además el trigger de 0009.

GRANT SELECT, INSERT ON "exchange_rates" TO contave_app;
