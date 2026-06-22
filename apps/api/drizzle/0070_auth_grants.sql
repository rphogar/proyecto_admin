-- P27 — GRANTs de las tablas de autenticación al rol de aplicación `contave_app`.
-- SQL custom (Drizzle no expresa GRANTs). Estas tablas son GLOBALES de identidad (sin RLS, como
-- `users`/`tenants`): la auth ocurre antes de elegir tenant. El rol de app sigue SIN BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contave_app') THEN
    RAISE EXCEPTION 'Falta el rol contave_app. Corré "pnpm db:bootstrap-roles" antes de migrar.';
  END IF;
END
$$;
--> statement-breakpoint

-- Sesión rotativa: la app crea, lee y marca rotado/revocado un refresh. Sin DELETE (la limpieza de
-- tokens vencidos, si se hace, va por un proceso de mantenimiento, no por el flujo de negocio).
GRANT SELECT, INSERT, UPDATE ON "refresh_tokens" TO contave_app;
--> statement-breakpoint

-- Recuperación: crear el token, leerlo al confirmar y marcar `used_at`. Sin DELETE.
GRANT SELECT, INSERT, UPDATE ON "password_reset_tokens" TO contave_app;
--> statement-breakpoint

-- Bitácora de identidad: solo lectura e inserción (append-only, regla 5). SIN UPDATE/DELETE.
GRANT SELECT, INSERT ON "auth_events" TO contave_app;
