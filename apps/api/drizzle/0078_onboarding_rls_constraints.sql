-- P30 — RLS y CHECK de la apertura de empresa (regla 12). SQL custom (Drizzle no expresa RLS/policies).
-- `company_aperturas` es tenant-scoped → aislamiento por `tenant_isolation`. El `UNIQUE(company_id)`
-- (en 0077) garantiza una sola apertura por empresa: es lo que hace IDEMPOTENTE el registro de saldos
-- iniciales (un segundo intento choca con el único y el servicio devuelve la apertura existente).

-- ── CHECK: estados válidos de la apertura ───────────────────────────────────────
ALTER TABLE "company_aperturas"
  ADD CONSTRAINT "company_aperturas_estado_valido"
  CHECK ("estado" IN ('REGISTRADA'));--> statement-breakpoint

-- ── Row Level Security (regla 12) ───────────────────────────────────────────────
ALTER TABLE "company_aperturas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_aperturas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "company_aperturas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
