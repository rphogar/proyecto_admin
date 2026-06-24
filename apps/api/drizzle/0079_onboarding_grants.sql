-- P30 — GRANTs de `company_aperturas` al rol de aplicación `contave_app`. SQL custom (Drizzle no
-- expresa GRANTs). Tabla tenant-scoped (bajo RLS): los GRANTs abren el privilegio, la RLS sigue
-- acotando las filas. El rol de app sigue SIN BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contave_app') THEN
    RAISE EXCEPTION 'Falta el rol contave_app. Corré "pnpm db:bootstrap-roles" antes de migrar.';
  END IF;
END
$$;
--> statement-breakpoint

-- Apertura: leer (estado del wizard) e insertar (registrar la apertura). Sin UPDATE/DELETE: la
-- apertura es un hecho registrado; corregir saldos se hace con asientos posteriores, no mutándola.
GRANT SELECT, INSERT ON "company_aperturas" TO contave_app;

-- NB: `companies` (SELECT/INSERT/UPDATE), `accounts`, `payment_methods`, `series`, `warehouses`,
-- `posting_templates*`, `periods`, `journal_entries`/`journal_lines` y `stock_moves` ya están
-- concedidos por sus módulos previos; el onboarding reusa esos privilegios para la precarga y el
-- asiento de apertura. No se re-otorgan aquí.
