-- P28 — Lectura de las PROPIAS membresías antes de elegir tenant (login / GET /auth/empresas).
-- `memberships` está bajo FORCE RLS con política `tenant_id = app_current_tenant()`, así que sin
-- contexto de tenant no se ve ninguna fila. Pero el login necesita enumerar las empresas del
-- usuario ANTES de fijar un tenant. Se añade un GUC `app.user_id` (lo fija `withUser`) y una
-- política PERMISSIVE de SOLO LECTURA que deja a un usuario ver SUS membresías (su propio
-- user_id) en cualquier tenant. Es additiva (OR) con `tenant_isolation`; no abre datos de negocio
-- ajenos (solo expone a qué empresas pertenece el propio usuario y con qué rol). Escritura sigue
-- gobernada solo por `tenant_isolation`. Drizzle no expresa funciones/policies → SQL custom.

-- Actor actual desde el GUC de sesión `app.user_id` (lo fija withUser()). missing_ok=true → si no
-- hay actor devuelve NULL → `user_id = NULL` nunca matchea → 0 filas extra (falla cerrado).
CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Solo SELECT: un usuario lee sus propias membresías para el selector de empresa. No concede
-- INSERT/UPDATE/DELETE (esos los sigue acotando `tenant_isolation` por tenant).
CREATE POLICY "memberships_self_read" ON "memberships"
  FOR SELECT
  USING ("user_id" = app_current_user());
