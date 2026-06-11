import { sql } from 'drizzle-orm';
import type { Database, DatabaseTx } from '../db/database.service';
import { requireTenantContext } from './tenant-context';

/**
 * Ejecuta `fn` dentro de una transacción que fija `app.tenant_id` (LOCAL a la tx) para que las
 * políticas de RLS acoten las filas al tenant actual. **Todo acceso de negocio pasa por aquí**:
 * es el único punto donde se activa el contexto de tenant en la base (regla 12 de CLAUDE.md).
 *
 * `set_config(..., true)` hace el ajuste local a la transacción, de modo que al terminar (o
 * volver la conexión al pool) no quede el tenant pegado en la conexión.
 *
 * @param tenantIdOverride tenant explícito (jobs/seeds/tests). Por defecto se toma del contexto
 *   de la petición (`requireTenantContext`).
 */
export async function withTenant<T>(
  db: Database,
  fn: (tx: DatabaseTx) => Promise<T>,
  tenantIdOverride?: string,
): Promise<T> {
  const tenantId = tenantIdOverride ?? requireTenantContext().tenantId;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
