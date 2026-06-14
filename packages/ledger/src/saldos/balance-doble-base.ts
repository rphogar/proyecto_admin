import { Money } from '@contave/shared';
import { MONEDA_USD_MGMT, MONEDA_VES } from '../asientos/linea';
import type { PlanDeCuentas } from '../cuentas/plan-de-cuentas';
import type { NaturalezaCuenta } from '../cuentas/naturaleza';
import type { MovimientoCuenta } from './saldos';

/**
 * Balance de comprobación en DOBLE base (VES fiscal + USD gerencial) a partir de movimientos ya
 * agregados (P13, docs/03 §6). A diferencia de `balanceDeComprobacion` (que carga todos los
 * Asientos en memoria y solo expone VES), aquí la agregación por cuenta ya viene resuelta —en la
 * API la hace SQL sobre `journal_lines` POSTED— y esta función puramente arma las columnas y
 * totales en ambas bases. El total del debe DEBE igualar al del haber en cada base (consecuencia
 * de que todo asiento cuadra en triple base, regla 7).
 */
export interface FilaBalanceDobleBase {
  readonly cuenta: string;
  readonly naturaleza?: NaturalezaCuenta;
  readonly debeVes: Money;
  readonly haberVes: Money;
  readonly saldoDeudorVes: Money;
  readonly debeUsd: Money;
  readonly haberUsd: Money;
  readonly saldoDeudorUsd: Money;
}

export interface BalanceDobleBase {
  readonly filas: ReadonlyArray<FilaBalanceDobleBase>;
  readonly totalDebeVes: Money;
  readonly totalHaberVes: Money;
  readonly totalDebeUsd: Money;
  readonly totalHaberUsd: Money;
  /** Invariante: ΣdebeVES = ΣhaberVES. */
  readonly cuadraVes: boolean;
  /** Invariante: ΣdebeUSD = ΣhaberUSD. */
  readonly cuadraUsd: boolean;
}

/**
 * Arma el balance de comprobación doble base. Las cuentas se devuelven en orden de código. Si se
 * pasa el `plan`, anota la naturaleza de cada cuenta.
 */
export function balanceDeComprobacionDesdeMovimientos(
  movimientos: ReadonlyArray<MovimientoCuenta>,
  opciones: { plan?: PlanDeCuentas } = {},
): BalanceDobleBase {
  const ordenados = [...movimientos].sort((a, b) =>
    a.cuenta < b.cuenta ? -1 : a.cuenta > b.cuenta ? 1 : 0,
  );

  let totalDebeVes = Money.cero(MONEDA_VES);
  let totalHaberVes = Money.cero(MONEDA_VES);
  let totalDebeUsd = Money.cero(MONEDA_USD_MGMT);
  let totalHaberUsd = Money.cero(MONEDA_USD_MGMT);
  const filas: FilaBalanceDobleBase[] = [];

  for (const mov of ordenados) {
    totalDebeVes = totalDebeVes.suma(mov.debeVes);
    totalHaberVes = totalHaberVes.suma(mov.haberVes);
    totalDebeUsd = totalDebeUsd.suma(mov.debeUsd);
    totalHaberUsd = totalHaberUsd.suma(mov.haberUsd);
    const naturaleza = opciones.plan?.cuenta(mov.cuenta)?.naturaleza;
    filas.push({
      cuenta: mov.cuenta,
      ...(naturaleza !== undefined ? { naturaleza } : {}),
      debeVes: mov.debeVes,
      haberVes: mov.haberVes,
      saldoDeudorVes: mov.debeVes.resta(mov.haberVes),
      debeUsd: mov.debeUsd,
      haberUsd: mov.haberUsd,
      saldoDeudorUsd: mov.debeUsd.resta(mov.haberUsd),
    });
  }

  return {
    filas,
    totalDebeVes,
    totalHaberVes,
    totalDebeUsd,
    totalHaberUsd,
    cuadraVes: totalDebeVes.igualA(totalHaberVes),
    cuadraUsd: totalDebeUsd.igualA(totalHaberUsd),
  };
}
