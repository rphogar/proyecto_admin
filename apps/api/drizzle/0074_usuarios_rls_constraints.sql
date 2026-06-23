-- P29 — RLS, constraints, índice único y aceptación pre-tenant de invitaciones (reglas 12/13).
-- SQL custom (Drizzle no expresa RLS/policies/funciones/índices parciales/backfill).
--
-- `invitations` y `segregacion_deberes` son tenant-scoped → RLS con `tenant_isolation`. La
-- ADMINISTRACIÓN de invitaciones (crear/listar/revocar) ocurre con contexto de tenant. Pero la
-- ACEPTACIÓN es PRE-tenant: el invitado todavía no pertenece al tenant (ni siquiera tiene `user` a
-- veces). Se resuelve con el mismo patrón que `memberships_self_read` (P28): un GUC de sesión
-- `app.invitation_token` (lo fija el servicio de aceptación) + políticas PERMISSIVE que dejan
-- LEER/MARCAR la fila cuyo `token_hash` coincide con ese GUC. Así NO hace falta SECURITY DEFINER ni
-- BYPASSRLS, y la superficie queda acotada a quien presenta el token correcto.

-- ── CHECK: estados válidos de la invitación ─────────────────────────────────────
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_estado_valido"
  CHECK ("estado" IN ('pending', 'accepted', 'revoked', 'expired'));--> statement-breakpoint

-- ── Row Level Security (regla 12) ───────────────────────────────────────────────
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invitations"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

ALTER TABLE "segregacion_deberes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "segregacion_deberes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "segregacion_deberes"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- ── Aceptación pre-tenant: token de invitación desde el GUC `app.invitation_token` ──
-- missing_ok=true → sin GUC devuelve NULL → `token_hash = NULL` nunca matchea (falla cerrado).
CREATE FUNCTION app_current_invitation_token() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.invitation_token', true), '') $$;--> statement-breakpoint

-- SOLO la fila cuyo hash coincide con el token presentado. Additiva (OR) con `tenant_isolation`; no
-- expone otras invitaciones del tenant. Permite leerla y marcarla aceptada sin contexto de tenant.
CREATE POLICY "invitations_token_read" ON "invitations"
  FOR SELECT
  USING ("token_hash" = app_current_invitation_token());--> statement-breakpoint
CREATE POLICY "invitations_token_accept" ON "invitations"
  FOR UPDATE
  USING ("token_hash" = app_current_invitation_token())
  WITH CHECK ("token_hash" = app_current_invitation_token());--> statement-breakpoint

-- ── Índice parcial único: a lo sumo UNA invitación viva por email/tenant ─────────
CREATE UNIQUE INDEX "invitations_pendiente_uq"
  ON "invitations" ("tenant_id", lower("email"))
  WHERE "estado" = 'pending';--> statement-breakpoint

-- Búsqueda por token (aceptación) y listados por tenant.
CREATE INDEX "invitations_token_idx" ON "invitations" ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" ("tenant_id", "estado");--> statement-breakpoint

-- ── Backfill: los usuarios preexistentes quedan verificados (no se rompe el login) ──
UPDATE "users" SET "email_verified" = true;
