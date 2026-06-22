import { sql } from 'drizzle-orm';
import type { Database, DatabaseTx } from '../db/database.service';

/**
 * Ejecuta `fn` con `app.user_id` fijado (LOCAL a la tx) para que la política `memberships_self_read`
 * (migración `0072`) deje al usuario leer SUS PROPIAS membresías ANTES de elegir tenant — lo que
 * necesitan el login y `GET /auth/empresas` para enumerar las empresas del usuario (P28).
 *
 * A diferencia de `withTenant`, NO fija `app.tenant_id`: es un contexto pre-tenant. Solo habilita
 * la lectura de las membresías propias; cualquier dato de negocio sigue requiriendo `withTenant`.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: DatabaseTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
