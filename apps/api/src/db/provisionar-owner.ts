import '../load-env';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from '../seguridad/password';

/**
 * Provisiona el **primer `owner` real** de un tenant para el arranque productivo (P32). El sistema
 * no tiene auto-registro público: una cuenta nueva la crea un operador con este script, que es el
 * reemplazo en producción del `db:seed-demo` (ese solo siembra datos de juguete y se niega a correr
 * con `NODE_ENV=production`). A partir de aquí el owner entra por el login real (`/login`) y da de
 * alta su empresa con el asistente de onboarding (P30). Ver `docs/12-ARRANQUE-PRODUCTIVO.md`.
 *
 * Conecta como el OWNER de Postgres (`DATABASE_URL`). `tenants`/`users` son globales (sin RLS);
 * `memberships` es tenant-scoped con FORCE RLS, así que se fija `app.tenant_id` en la sesión para
 * pasar el WITH CHECK de la política (igual que `withTenant` en runtime y el seed demo).
 *
 * Entradas por variables de entorno (no por argumentos, para no dejar la clave en el historial del
 * shell):
 *   OWNER_EMAIL, OWNER_PASSWORD (≥ 12 caracteres), OWNER_NOMBRE, TENANT_NOMBRE, TENANT_SLUG
 */

interface DatosOwner {
  email: string;
  password: string;
  nombre: string;
  tenantNombre: string;
  tenantSlug: string;
}

function leerEntorno(): DatosOwner {
  const faltan: string[] = [];
  const req = (clave: string): string => {
    const v = process.env[clave]?.trim();
    if (!v) {
      faltan.push(clave);
      return '';
    }
    return v;
  };
  const datos = {
    email: req('OWNER_EMAIL'),
    password: req('OWNER_PASSWORD'),
    nombre: req('OWNER_NOMBRE'),
    tenantNombre: req('TENANT_NOMBRE'),
    tenantSlug: req('TENANT_SLUG'),
  };
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno: ${faltan.join(', ')}`);
  }
  if (datos.password.length < 12) {
    throw new Error('OWNER_PASSWORD debe tener al menos 12 caracteres.');
  }
  if (!/^[a-z0-9-]+$/.test(datos.tenantSlug)) {
    throw new Error('TENANT_SLUG debe ser kebab-case ([a-z0-9-]).');
  }
  return datos;
}

export async function provisionarOwner(ownerUrl: string, datos: DatosOwner): Promise<{ tenantId: string; userId: string }> {
  const sql = postgres(ownerUrl, { max: 1 });
  try {
    const yaExiste = await sql<{ id: string }[]>`SELECT id FROM "users" WHERE lower(email) = lower(${datos.email}) LIMIT 1`;
    if (yaExiste.length > 0) {
      throw new Error(`Ya existe un usuario con el correo ${datos.email}; provisiona uno nuevo o invítalo a un tenant existente.`);
    }

    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = await hashPassword(datos.password);

    await sql.begin(async (tx) => {
      await tx`INSERT INTO "tenants" ("id", "nombre", "slug") VALUES (${tenantId}, ${datos.tenantNombre}, ${datos.tenantSlug})`;
      // email_verified=true: lo crea un operador de confianza, no hay buzón que confirmar.
      await tx`
        INSERT INTO "users" ("id", "email", "nombre", "password_hash", "email_verified")
        VALUES (${userId}, ${datos.email}, ${datos.nombre}, ${passwordHash}, true)
      `;
      // Fija el contexto de tenant para el WITH CHECK de la RLS de memberships.
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`INSERT INTO "memberships" ("tenant_id", "user_id", "role") VALUES (${tenantId}, ${userId}, 'owner')`;
    });

    return { tenantId, userId };
  } finally {
    await sql.end();
  }
}

// Entrada CLI: `pnpm db:provisionar-owner`.
const isCli = process.argv[1]?.includes('provisionar-owner');
if (isCli) {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error('Falta DATABASE_URL (conexión OWNER de Postgres).');
    process.exitCode = 1;
  } else {
    (async () => {
      const datos = leerEntorno();
      const { tenantId, userId } = await provisionarOwner(ownerUrl, datos);
      console.log('Owner provisionado.');
      console.log(`  tenant : ${tenantId} (${datos.tenantNombre})`);
      console.log(`  usuario: ${userId} (${datos.email}, rol owner)`);
      console.log('Entra por /login y da de alta tu empresa con el asistente de onboarding.');
    })().catch((err: unknown) => {
      console.error('Fallo la provisión del owner:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
  }
}
