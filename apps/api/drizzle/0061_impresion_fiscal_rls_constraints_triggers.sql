-- P23 — Impresora fiscal: CHECKs, RLS e índices de la cola de impresión `fiscal_print_queue`
-- (docs/02 §6.1, docs/05 §5). SQL custom (Drizzle no expresa RLS/CHECK/índices). Molde de 0054.

-- Dominio de estado del job de impresión.
ALTER TABLE "fiscal_print_queue"
  ADD CONSTRAINT "fiscal_print_queue_estado_valido"
  CHECK ("estado" IN ('PENDIENTE', 'RECLAMADO', 'IMPRESO', 'ERROR'));--> statement-breakpoint
ALTER TABLE "fiscal_print_queue"
  ADD CONSTRAINT "fiscal_print_queue_reintentos_no_negativo"
  CHECK ("reintentos" >= 0 AND "reintentos" <= "max_reintentos");--> statement-breakpoint

-- RLS (regla 12): aislamiento por tenant, forzado incluso para el owner de la tabla.
ALTER TABLE "fiscal_print_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_print_queue" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_print_queue"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- Índice del agente: jobs elegibles (PENDIENTE/ERROR transitorio) ordenados por próximo intento.
CREATE INDEX "fiscal_print_queue_pendientes_idx"
  ON "fiscal_print_queue" ("tenant_id", "estado", "proximo_intento");
