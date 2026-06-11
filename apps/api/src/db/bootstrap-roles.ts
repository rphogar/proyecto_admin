import postgres from 'postgres';

/**
 * Crea/actualiza el rol de aplicación `contave_app` (decisión P2: las migraciones corren como
 * el owner `contave`, pero la API conecta con un rol dedicado SIN BYPASSRLS y sin ownership,
 * para que RLS lo gobierne de verdad). Idempotente.
 *
 * Debe correr ANTES de `db:migrate`: la migración `0004_grants` concede privilegios a este
 * rol y por tanto el rol ya debe existir. Los GRANTs a nivel de tabla viven en esa migración;
 * aquí solo se garantizan el rol, su password, CONNECT a la base y USAGE del esquema.
 */
export interface BootstrapRolesOptions {
  /** Conexión como owner/superuser con permiso para CREATE ROLE. */
  ownerUrl: string;
  /** Nombre del rol de aplicación. Default: `contave_app`. */
  appRole?: string;
  /** Password del rol de aplicación. */
  appPassword: string;
}

const ROLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/** Escapa un literal de cadena SQL (duplica comillas simples). */
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function bootstrapRoles(opts: BootstrapRolesOptions): Promise<void> {
  const appRole = opts.appRole ?? 'contave_app';
  if (!ROLE_NAME_RE.test(appRole)) {
    throw new Error(`Nombre de rol inválido: ${appRole}`);
  }
  if (opts.appPassword.length === 0) {
    throw new Error('Password del rol de aplicación vacío.');
  }

  const sql = postgres(opts.ownerUrl, { max: 1 });
  try {
    const pwd = quoteLiteral(opts.appPassword);
    // El nombre de rol ya está validado contra ROLE_NAME_RE, seguro para interpolar.
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE ${appRole} LOGIN NOBYPASSRLS PASSWORD ${pwd};
        ELSE
          ALTER ROLE ${appRole} WITH LOGIN NOBYPASSRLS PASSWORD ${pwd};
        END IF;
      END
      $$;
    `);

    const rows = await sql<{ db: string }[]>`SELECT current_database() AS db`;
    const db = rows[0]?.db;
    if (db === undefined) {
      throw new Error('No se pudo determinar la base de datos actual.');
    }
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${db}" TO ${appRole};`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${appRole};`);
  } finally {
    await sql.end();
  }
}

/** Deriva el password del rol app desde env (explícito o parseado de APP_DATABASE_URL). */
export function appPasswordFromEnv(): string {
  if (process.env.APP_DB_PASSWORD) {
    return process.env.APP_DB_PASSWORD;
  }
  const appUrl = process.env.APP_DATABASE_URL;
  if (appUrl) {
    const parsed = new URL(appUrl);
    if (parsed.password) {
      return decodeURIComponent(parsed.password);
    }
  }
  return 'contave_app_dev';
}

// Entrada CLI: `pnpm db:bootstrap-roles`.
const isCli = process.argv[1]?.includes('bootstrap-roles');
if (isCli) {
  const ownerUrl =
    process.env.DATABASE_URL ?? 'postgresql://contave:contave_dev@localhost:5432/contave';
  bootstrapRoles({ ownerUrl, appPassword: appPasswordFromEnv() })
    .then(() => {
      console.log('Rol de aplicación contave_app listo.');
    })
    .catch((err: unknown) => {
      console.error('Fallo bootstrap del rol de aplicación:', err);
      process.exitCode = 1;
    });
}
