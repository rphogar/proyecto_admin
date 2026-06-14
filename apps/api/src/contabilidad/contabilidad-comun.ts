import { PlanDeCuentas } from '@contave/ledger';
import { eq } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { accounts, memberships } from '../db/schema';

/**
 * Helpers compartidos por los servicios de contabilidad (P13). Reutilizan los de tesorería para no
 * duplicar la resolución del plan (código↔id), la verificación de período abierto y el hash de
 * integridad. Todo se ejecuta DENTRO de `withTenant` (RLS).
 */
export { cargarCuentas, requerirPeriodoAbierto, hashIntegridad, type MapasCuentas } from '../tesoreria/tesoreria-comun';

/** Clave de mes fiscal (Caracas). */
export interface ClaveMes {
  readonly anio: number;
  readonly mes: number;
}

/** Ordinal de un mes para comparar rangos de período (`anio*12 + mes − 1`). */
export function ordinalMes(c: ClaveMes): number {
  return c.anio * 12 + (c.mes - 1);
}

/**
 * Construye el `PlanDeCuentas` (árbol validado) a partir del plan sembrado de la empresa. Las
 * funciones puras del ledger (rollup, estados, naturaleza por cuenta) operan sobre este árbol.
 */
export async function cargarPlan(tx: DatabaseTx, companyId: string): Promise<PlanDeCuentas> {
  const filas = await tx
    .select({ codigo: accounts.codigo, nombre: accounts.nombre, moneda: accounts.moneda, esSistema: accounts.esSistema })
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  return PlanDeCuentas.desde(
    filas.map((f) => ({
      codigo: f.codigo,
      nombre: f.nombre,
      ...(f.moneda != null ? { moneda: f.moneda } : {}),
      esSistema: f.esSistema,
    })),
  );
}

/**
 * Rol del actor en el tenant actual (para autorizar acciones sensibles, p.ej. la reapertura de un
 * período — caso 43). `memberships` está bajo RLS (tenant en contexto), así que basta filtrar por
 * usuario. Devuelve `null` si no hay membresía (o no hay actor).
 */
export async function rolDelActor(tx: DatabaseTx, userId: string | undefined | null): Promise<string | null> {
  if (userId == null) return null;
  const [fila] = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
  return fila?.role ?? null;
}
