import { planDeCuentasBase } from '@contave/ledger';
import type { DatabaseTx } from '../db/database.service';
import { accounts } from '../db/schema';

/**
 * Siembra el plan de cuentas base (docs/03 §2) para una empresa (docs/05 §3.2). El plan es
 * tenant-scoped, así que esto corre dentro de `withTenant()` (RLS fija `app.tenant_id`).
 *
 * La naturaleza, nivel, código del padre y `es_movimiento` (hoja) se DERIVAN del árbol
 * (`@contave/ledger`), no se hardcodean. Idempotencia: si la empresa ya tiene cuentas con esos
 * códigos, `ON CONFLICT (company_id, codigo) DO NOTHING` evita duplicados.
 *
 * @returns cantidad de cuentas insertadas (0 si ya estaba sembrado).
 */
export async function seedPlanDeCuentas(
  tx: DatabaseTx,
  params: { tenantId: string; companyId: string },
): Promise<number> {
  const plan = planDeCuentasBase();
  const filas = plan.todas().map((c) => ({
    tenantId: params.tenantId,
    companyId: params.companyId,
    codigo: c.codigo,
    nombre: c.nombre,
    naturaleza: c.naturaleza,
    nivel: c.nivel,
    codigoPadre: c.codigoPadre,
    esMovimiento: c.esMovimiento,
    moneda: c.moneda ?? null,
    esSistema: c.esSistema ?? true,
  }));

  const insertadas = await tx
    .insert(accounts)
    .values(filas)
    .onConflictDoNothing({ target: [accounts.companyId, accounts.codigo] })
    .returning({ id: accounts.id });

  return insertadas.length;
}
