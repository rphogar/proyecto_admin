-- P2 — Row Level Security (regla 12 de CLAUDE.md) + EXCLUDE de vigencias (regla 17).
-- Drizzle no expresa RLS/policies/EXCLUDE; va en SQL custom.

-- btree_gist habilita operadores `=` sobre uuid/text dentro de una EXCLUDE con GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- fiscal_params: prohíbe vigencias solapadas para una misma (tenant_id, clave).
-- daterange '[)' semiabierto; vigente_hasta NULL = vigencia abierta (hasta +infinito).
ALTER TABLE "fiscal_params"
  ADD CONSTRAINT "fiscal_params_vigencia_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "clave" WITH =,
    (daterange("vigente_desde", "vigente_hasta", '[)')) WITH &&
  );
--> statement-breakpoint

-- Tenant actual tomado del GUC de sesión `app.tenant_id` (lo fija withTenant() por request).
-- missing_ok=true → si no hay contexto devuelve NULL → ninguna política matchea → 0 filas /
-- INSERT rechazado. Esto materializa "ninguna query sin contexto de tenant" (regla 12).
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint

-- ENABLE + FORCE en cada tabla tenant-scoped: FORCE somete incluso al owner de la tabla
-- (decisión P2: defensa en profundidad junto al rol app sin BYPASSRLS).
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "companies"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branches"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "fiscal_params" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "fiscal_params" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_params"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_events"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
