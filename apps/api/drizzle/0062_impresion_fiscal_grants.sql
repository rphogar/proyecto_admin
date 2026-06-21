-- P23 — GRANTs de la cola de impresión al rol de aplicación `contave_app` (rol sin BYPASSRLS).
-- La cola muta de estado (PENDIENTE→RECLAMADO→IMPRESO/ERROR) y acumula reintentos: SELECT + INSERT +
-- UPDATE, SIN DELETE (no se borra un registro de impresión; queda como rastro). Molde de 0055.

GRANT SELECT, INSERT, UPDATE ON "fiscal_print_queue" TO contave_app;
