-- P2 — GRANTs al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol debe existir ya (correr `pnpm db:bootstrap-roles` antes de `db:migrate`).
-- Guard explícito con mensaje claro si falta, para no fallar con un error críptico.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contave_app') THEN
    RAISE EXCEPTION 'Falta el rol contave_app. Corré "pnpm db:bootstrap-roles" antes de migrar.';
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO contave_app;
--> statement-breakpoint

-- Tablas de negocio tenant-scoped: CRUD completo (RLS acota las filas por tenant).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "memberships", "companies", "branches", "fiscal_params" TO contave_app;
--> statement-breakpoint

-- audit_events: solo lectura e inserción. SIN UPDATE/DELETE (append-only, regla 5).
GRANT SELECT, INSERT ON "audit_events" TO contave_app;
--> statement-breakpoint

-- Identidad: la app crea/lee tenants y usuarios (signup, perfil). Sin DELETE de identidades.
GRANT SELECT, INSERT, UPDATE ON "tenants", "users" TO contave_app;
--> statement-breakpoint

-- Catálogo RBAC: solo lectura (se siembra/administra fuera de la app).
GRANT SELECT ON "roles", "permissions", "role_permissions" TO contave_app;
