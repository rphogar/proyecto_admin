import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { bootstrapRoles } from '../src/db/bootstrap-roles';
import * as schema from '../src/db/schema';

const APP_PASSWORD = 'contave_app_test';
// Vitest corre con la raíz del paquete (apps/api) como cwd; las migraciones están en ./drizzle.
const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

export interface TestDatabase {
  /** Conexión owner/superuser: corre setup ignorando RLS (BYPASS por superuser). */
  ownerSql: Sql;
  /** Conexión cruda como rol de aplicación `contave_app` (SIN BYPASSRLS). */
  appSql: Sql;
  /** Drizzle sobre el rol de aplicación; usar con `withTenant`. */
  appDb: PostgresJsDatabase<typeof schema>;
  /** Detiene conexiones y contenedor. */
  stop: () => Promise<void>;
}

/**
 * Levanta un Postgres 16 efímero, crea el rol de aplicación, corre TODAS las migraciones
 * (DDL + RLS + grants + triggers + seed) y devuelve conexiones owner y app. Una llamada por
 * suite (en `beforeAll`).
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16').start();

  const ownerUrl = container.getConnectionUri();
  const appUrl = `postgresql://contave_app:${APP_PASSWORD}@${container.getHost()}:${container.getMappedPort(5432)}/${container.getDatabase()}`;

  // 1) Rol app antes de migrar (la migración 0003 le concede privilegios).
  await bootstrapRoles({ ownerUrl, appPassword: APP_PASSWORD });

  // 2) Migraciones como owner (superuser: CREATE EXTENSION, etc.).
  const migrationSql = postgres(ownerUrl, { max: 1 });
  try {
    await migrate(drizzle(migrationSql), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await migrationSql.end();
  }

  const ownerSql = postgres(ownerUrl);
  const appSql = postgres(appUrl);
  const appDb = drizzle(appSql, { schema });

  return {
    ownerSql,
    appSql,
    appDb,
    stop: async () => {
      await ownerSql.end();
      await appSql.end();
      await container.stop();
    },
  };
}
