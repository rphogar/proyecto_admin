import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Carga apps/api/.env para que `drizzle-kit migrate` vea DATABASE_URL (Node nativo, sin deps).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Placeholder del bootstrap (P0): el esquema (tenants, RLS, audit_events, …) se crea en P2.
// La carpeta src/db/schema/ está vacía intencionalmente hasta entonces.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://contave:contave_dev@localhost:5432/contave',
  },
  verbose: true,
  strict: true,
});
