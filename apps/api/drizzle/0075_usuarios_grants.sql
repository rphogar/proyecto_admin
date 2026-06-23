-- P29 — GRANTs de las tablas de gestión de usuarios al rol de aplicación `contave_app`.
-- SQL custom (Drizzle no expresa GRANTs). Ambas tablas son tenant-scoped (bajo RLS): los GRANTs
-- abren el privilegio, pero la RLS sigue acotando las filas. El rol de app sigue SIN BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contave_app') THEN
    RAISE EXCEPTION 'Falta el rol contave_app. Corré "pnpm db:bootstrap-roles" antes de migrar.';
  END IF;
END
$$;
--> statement-breakpoint

-- Invitaciones: crear (invitar), leer (listar/aceptar) y marcar (revocar/aceptar/expirar). Sin
-- DELETE (el ciclo de vida se modela con `estado`, queda traza).
GRANT SELECT, INSERT, UPDATE ON "invitations" TO contave_app;
--> statement-breakpoint

-- Separación de deberes: leer y crear/actualizar la fila que desactiva/reactiva una regla.
GRANT SELECT, INSERT, UPDATE ON "segregacion_deberes" TO contave_app;

-- NB: `memberships` (CRUD) y `users` (SELECT/INSERT/UPDATE) ya están concedidos en 0003; la
-- aceptación de invitación reusa esos privilegios para insertar la membresía y marcar
-- `email_verified`. No se re-otorgan aquí.
