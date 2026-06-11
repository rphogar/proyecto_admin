-- P4 — exchange_rates: RLS híbrida, CHECKs, idempotencia e inmutabilidad (reglas 1, 2, 4, 5, 12
-- de CLAUDE.md, docs/05 §3.3). Drizzle no expresa RLS/CHECK/índices parciales/triggers: SQL custom.

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_source_valido" CHECK ("source" IN ('BCV', 'MANUAL', 'MARKET'));
--> statement-breakpoint
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_currency_valido" CHECK ("currency" IN ('USD', 'EUR'));
--> statement-breakpoint
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_rate_positivo" CHECK ("rate" > 0);
--> statement-breakpoint
-- Una entrada MANUAL debe declarar motivo (entrada auditada, regla 5).
ALTER TABLE "exchange_rates"
  ADD CONSTRAINT "exchange_rates_manual_con_motivo"
  CHECK ("source" <> 'MANUAL' OR "motivo" IS NOT NULL);
--> statement-breakpoint

-- ── Idempotencia del job (caso 11) ───────────────────────────────────────────
-- Re-correr la captura con la MISMA tasa choca y se descarta (ON CONFLICT DO NOTHING).
-- NULLS NOT DISTINCT (PG15+) hace que dos filas globales (tenant_id NULL) idénticas colisionen.
-- Una corrección del BCV (mismo día, rate distinto, caso 3) NO choca: entra como fila nueva.
CREATE UNIQUE INDEX "exchange_rates_idempotencia_uq"
  ON "exchange_rates" ("tenant_id", "currency", "rate_date", "source", "rate") NULLS NOT DISTINCT;
--> statement-breakpoint
-- Índice de resolución de rateFor: por moneda y fecha, desempatando por captura.
CREATE INDEX "exchange_rates_resolucion_idx"
  ON "exchange_rates" ("currency", "rate_date" DESC, "captured_at" DESC);
--> statement-breakpoint

-- ── Row Level Security híbrida (regla 12) ────────────────────────────────────
-- NULL = tasa global BCV (visible para todos); no-null = tasa propia del tenant. La policy
-- admite leer/insertar globales y las del tenant actual; el job inserta globales en una tx sin
-- contexto de tenant (app_current_tenant() = NULL ⇒ sólo pasa la rama `tenant_id IS NULL`).
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation_global" ON "exchange_rates"
  USING ("tenant_id" IS NULL OR "tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" IS NULL OR "tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad: append-only (reglas 4/5, igual que audit_events) ──────────
-- Una tasa usada por documentos NUNCA se sobreescribe; correcciones = fila nueva (reemplaza_a).
CREATE FUNCTION exchange_rates_no_mutate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'exchange_rates es append-only (reglas 4/5): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER "exchange_rates_no_mutate"
  BEFORE UPDATE OR DELETE ON "exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION exchange_rates_no_mutate();
