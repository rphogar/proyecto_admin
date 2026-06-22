import '../load-env';
import postgres from 'postgres';
import { hashPassword } from '../seguridad/password';
import { DEMO } from './demo-fixtures';

/**
 * Siembra la empresa DEMO para desarrollo (un tenant, un usuario owner, una empresa y una tasa
 * BCV global del día). Idempotente (`ON CONFLICT DO NOTHING`). NO es una migración a propósito:
 * los datos demo no deben viajar a producción; esto se corre a mano con `pnpm db:seed-demo`.
 *
 * Conecta como el OWNER (`DATABASE_URL`), no como el rol de aplicación: las tablas tenant-scoped
 * tienen FORCE ROW LEVEL SECURITY, así que igual hay que fijar `app.tenant_id` en la sesión para
 * pasar el WITH CHECK de las políticas (igual que hace `withTenant` en runtime).
 */
export async function seedDemo(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1 });
  try {
    // Globales (sin RLS): identidad del tenant y del usuario.
    await sql`
      INSERT INTO "tenants" ("id", "nombre", "slug")
      VALUES (${DEMO.tenant.id}, ${DEMO.tenant.nombre}, ${DEMO.tenant.slug})
      ON CONFLICT ("id") DO NOTHING
    `;
    // Contraseña demo hasheada con Argon2id (P27) para probar el login real; se re-aplica en cada
    // seed (idempotente) por si el usuario ya existía sin hash.
    const passwordHash = await hashPassword(DEMO.usuario.password);
    await sql`
      INSERT INTO "users" ("id", "email", "nombre", "password_hash")
      VALUES (${DEMO.usuario.id}, ${DEMO.usuario.email}, ${DEMO.usuario.nombre}, ${passwordHash})
      ON CONFLICT ("id") DO UPDATE SET "password_hash" = EXCLUDED."password_hash"
    `;

    // Fija el contexto de tenant en la sesión (is_local=false → persiste entre statements de
    // esta conexión) para que las políticas RLS de companies/memberships acepten los INSERT.
    await sql`SELECT set_config('app.tenant_id', ${DEMO.tenant.id}, false)`;

    await sql`
      INSERT INTO "companies"
        ("id", "tenant_id", "rif", "razon_social", "direccion_fiscal", "tipo_contribuyente")
      VALUES (
        ${DEMO.empresa.id}, ${DEMO.tenant.id}, ${DEMO.empresa.rif}, ${DEMO.empresa.razonSocial},
        ${DEMO.empresa.direccionFiscal}, ${DEMO.empresa.tipoContribuyente}
      )
      ON CONFLICT ("id") DO NOTHING
    `;
    await sql`
      INSERT INTO "companies"
        ("id", "tenant_id", "rif", "razon_social", "direccion_fiscal", "tipo_contribuyente", "spe")
      VALUES (
        ${DEMO.empresaSpe.id}, ${DEMO.tenant.id}, ${DEMO.empresaSpe.rif}, ${DEMO.empresaSpe.razonSocial},
        ${DEMO.empresaSpe.direccionFiscal}, ${DEMO.empresaSpe.tipoContribuyente}, true
      )
      ON CONFLICT ("id") DO NOTHING
    `;
    await sql`
      INSERT INTO "memberships" ("tenant_id", "user_id", "role")
      VALUES (${DEMO.tenant.id}, ${DEMO.usuario.id}, ${DEMO.usuario.role})
      ON CONFLICT ("tenant_id", "user_id") DO NOTHING
    `;

    // Calendario SPE de muestra (datos por providencia, regla 17): fechas límite del año en curso
    // para el terminal de RIF de la empresa especial. En producción se importa por providencia.
    const anio = new Date().getFullYear();
    const calendario = calendarioSpeMuestra(anio, DEMO.empresaSpe.terminalRif);
    await sql`
      INSERT INTO "fiscal_params" ("tenant_id", "clave", "valor", "vigente_desde", "vigente_hasta")
      VALUES (
        ${DEMO.tenant.id}, 'CALENDARIO_SPE', ${sql.json(calendario)},
        ${`${anio}-01-01`}, ${`${anio + 1}-01-01`}
      )
      ON CONFLICT DO NOTHING
    `;

    // Tasas BCV globales del día (tenant_id NULL) para que la "tasa del día" muestre algo de
    // entrada en USD y EUR, aun si la captura en vivo del BCV no corrió todavía (respaldo demo).
    await sql`
      INSERT INTO "exchange_rates" ("tenant_id", "currency", "rate", "rate_date", "source")
      VALUES
        (NULL, 'USD', '40.00000000', CURRENT_DATE, 'BCV'),
        (NULL, 'EUR', '45.00000000', CURRENT_DATE, 'BCV')
      ON CONFLICT DO NOTHING
    `;
  } finally {
    await sql.end();
  }
}

/**
 * Calendario SPE de muestra para un año y un terminal de RIF: una fila de IVA e IGTF por mes, con
 * fecha límite el día 20 del mes siguiente (los SPE declaran más tarde que el ordinario). Es solo
 * dato de ejemplo para desarrollo; la providencia real se importa por `POST /impuestos/calendario-spe/importar`.
 */
function calendarioSpeMuestra(anio: number, terminalRif: string): Array<{
  terminalRif: string;
  tipo: string;
  periodoAnio: number;
  periodoMes: number;
  fechaLimite: string;
}> {
  const filas = [];
  for (let mes = 1; mes <= 12; mes++) {
    const venceAnio = mes === 12 ? anio + 1 : anio;
    const venceMes = mes === 12 ? 1 : mes + 1;
    const fechaLimite = `${venceAnio}-${String(venceMes).padStart(2, '0')}-20`;
    for (const tipo of ['IVA', 'IGTF']) {
      filas.push({ terminalRif, tipo, periodoAnio: anio, periodoMes: mes, fechaLimite });
    }
  }
  return filas;
}

// Entrada CLI: `pnpm db:seed-demo`.
const isCli = process.argv[1]?.includes('seed-demo');
if (isCli) {
  if (process.env.NODE_ENV === 'production') {
    console.error('Negado: el seed demo no se ejecuta en producción.');
    process.exitCode = 1;
  } else {
    const ownerUrl =
      process.env.DATABASE_URL ?? 'postgresql://contave:contave_dev@localhost:5432/contave';
    seedDemo(ownerUrl)
      .then(() => {
        console.log('Empresa DEMO sembrada.');
        console.log(`  tenant : ${DEMO.tenant.id} (${DEMO.tenant.nombre})`);
        console.log(`  empresa: ${DEMO.empresa.id} (${DEMO.empresa.razonSocial})`);
        console.log(`  usuario: ${DEMO.usuario.id} (${DEMO.usuario.email})`);
      })
      .catch((err: unknown) => {
        console.error('Fallo el seed demo:', err);
        process.exitCode = 1;
      });
  }
}
