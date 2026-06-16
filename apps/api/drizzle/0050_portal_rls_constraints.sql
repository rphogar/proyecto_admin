-- P16 — Portal del contador: CHECK, RLS e índice de `delegaciones` (reglas 12/13 de CLAUDE.md).
-- La delegación es tenant-scoped (RLS): un contador solo ve/recibe permisos de empresas del tenant
-- en contexto. No es inmutable (una delegación se reotorga y se revoca legítimamente); la traza de
-- quién/ cuándo queda en las columnas y en `audit_events`. SQL custom (Drizzle no lo expresa).

-- ── CHECK constraint ──────────────────────────────────────────────────────────
ALTER TABLE "delegaciones"
  ADD CONSTRAINT "delegaciones_estado_valido" CHECK ("estado" IN ('ACTIVA', 'REVOCADA'));--> statement-breakpoint

-- ── Row Level Security (regla 12) ───────────────────────────────────────────────
ALTER TABLE "delegaciones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delegaciones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "delegaciones"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- ── Índice: delegaciones por usuario (cartera del contador) ──────────────────────
CREATE INDEX "delegaciones_tenant_user_idx" ON "delegaciones" ("tenant_id", "user_id");
