-- P17 — GRANTs de cumplimiento al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- fiscal_event_log es append-only como audit_events: SELECT + INSERT, SIN UPDATE/DELETE (req. 1/3;
-- la inmutabilidad la refuerza el trigger de 0054). La cola de remisión SÍ muta (estado/reintentos):
-- SELECT + INSERT + UPDATE, sin DELETE (no se borra un registro de remisión). product_versions es
-- catálogo global del proveedor: el rol solo lee (las versiones se publican por migración/seed).

GRANT SELECT, INSERT ON "fiscal_event_log" TO contave_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fiscal_transmission_queue" TO contave_app;--> statement-breakpoint
GRANT SELECT ON "product_versions" TO contave_app;
