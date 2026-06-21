-- P24 — GRANTs de la cola de entregas digitales al rol de aplicación `contave_app` (sin BYPASSRLS).
-- La cola muta de estado (PENDIENTE→ENTREGADO/ERROR, conservación análoga) y acumula reintentos:
-- SELECT + INSERT + UPDATE, SIN DELETE (la entrega/conservación queda como rastro). Molde de 0062.

GRANT SELECT, INSERT, UPDATE ON "digital_invoice_deliveries" TO contave_app;
