-- P17 — Cumplimiento Providencia SNAT/2024/000121: CHECKs, RLS, índices e inmutabilidad de la
-- bitácora fiscal y la cola de remisión (docs/02 §6.3, docs/05 §3.9). SQL custom (Drizzle no expresa
-- RLS/CHECK/índices/triggers).

-- ════════════════════════════════════════════════════════════════════════════════
-- fiscal_event_log — bitácora fiscal encadenada y APPEND-ONLY (req. 1 y 3)
-- ════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "fiscal_event_log"
  ADD CONSTRAINT "fiscal_event_log_event_type_valido"
  CHECK ("event_type" IN ('EMISION', 'IMPRESION', 'REIMPRESION', 'NOTA_CREDITO', 'NOTA_DEBITO', 'ANULACION', 'FALLO'));--> statement-breakpoint

-- RLS (regla 12).
ALTER TABLE "fiscal_event_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_event_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_event_log"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- Índice de recorrido cronológico de la cadena por tenant (cabeza de cadena = MAX(created_at)).
CREATE INDEX "fiscal_event_log_cadena_idx" ON "fiscal_event_log" ("tenant_id", "created_at");--> statement-breakpoint
-- Índice de consulta por documento (drill-down documento ↔ eventos).
CREATE INDEX "fiscal_event_log_documento_idx" ON "fiscal_event_log" ("tenant_id", "document_id");--> statement-breakpoint

-- Append-only: trigger que aborta UPDATE/DELETE incluso para el owner (igual que audit_events).
CREATE FUNCTION fiscal_event_log_no_mutate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'fiscal_event_log es append-only (Providencia 121): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "fiscal_event_log_no_mutate"
  BEFORE UPDATE OR DELETE ON "fiscal_event_log"
  FOR EACH ROW EXECUTE FUNCTION fiscal_event_log_no_mutate();--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════
-- fiscal_transmission_queue — cola de remisión MUTABLE (transita de estado)
-- ════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "fiscal_transmission_queue"
  ADD CONSTRAINT "fiscal_transmission_queue_estado_valido"
  CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'ACUSADO', 'ERROR'));--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue"
  ADD CONSTRAINT "fiscal_transmission_queue_reintentos_no_negativo"
  CHECK ("reintentos" >= 0 AND "reintentos" <= "max_reintentos");--> statement-breakpoint

ALTER TABLE "fiscal_transmission_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_transmission_queue"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- Índice del procesador: ítems elegibles (PENDIENTE/ERROR transitorio) ordenados por próximo intento.
CREATE INDEX "fiscal_transmission_queue_pendientes_idx"
  ON "fiscal_transmission_queue" ("tenant_id", "estado", "proximo_intento");--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════
-- product_versions — versionado formal del producto (req. 6). Tabla GLOBAL: sin tenant_id,
-- sin RLS (catálogo del proveedor, igual para todos los tenants). Solo unicidad de versión.
-- ════════════════════════════════════════════════════════════════════════════════
ALTER TABLE "product_versions"
  ADD CONSTRAINT "product_versions_version_uq" UNIQUE ("version");--> statement-breakpoint
ALTER TABLE "product_versions"
  ADD CONSTRAINT "product_versions_estado_valido"
  CHECK ("estado_homologacion" IN ('DESARROLLO', 'SOLICITADA', 'HOMOLOGADA', 'RECHAZADA'));
