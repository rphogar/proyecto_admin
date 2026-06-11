import { Money } from '@contave/shared';
import type { Asiento } from '../asientos/asiento';
import { MONEDA_USD_MGMT, MONEDA_VES } from '../asientos/linea';
import type { PlanDeCuentas } from '../cuentas/plan-de-cuentas';
import { type NaturalezaCuenta, saldoNormal } from '../cuentas/naturaleza';

/**
 * Saldos derivados del ledger (regla 8 de CLAUDE.md, docs/05 §7.5). Ningún saldo se almacena
 * como verdad: se DERIVA de los asientos POSTED y es siempre reconstruible. El cálculo es
 * determinista y, por ser sumas de `Money` (exactas), independiente del orden de los asientos.
 */

/** Movimiento acumulado de una cuenta (debe/haber en ambas bases). */
export interface MovimientoCuenta {
  readonly cuenta: string;
  readonly debeVes: Money;
  readonly haberVes: Money;
  readonly debeUsd: Money;
  readonly haberUsd: Money;
}

function movimientoVacio(cuenta: string): MovimientoCuenta {
  return {
    cuenta,
    debeVes: Money.cero(MONEDA_VES),
    haberVes: Money.cero(MONEDA_VES),
    debeUsd: Money.cero(MONEDA_USD_MGMT),
    haberUsd: Money.cero(MONEDA_USD_MGMT),
  };
}

/**
 * Mayor: movimiento acumulado por cuenta a partir de los asientos POSTED (los DRAFT se ignoran:
 * no son verdad contable). Las cuentas se devuelven en orden de código.
 */
export function calcularMayor(asientos: ReadonlyArray<Asiento>): Map<string, MovimientoCuenta> {
  const acc = new Map<string, MovimientoCuenta>();

  for (const asiento of asientos) {
    if (asiento.estado !== 'POSTED') continue;
    for (const linea of asiento.lineas) {
      const m = acc.get(linea.cuenta) ?? movimientoVacio(linea.cuenta);
      acc.set(
        linea.cuenta,
        linea.dc === 'D'
          ? { ...m, debeVes: m.debeVes.suma(linea.montoVes), debeUsd: m.debeUsd.suma(linea.montoUsdMgmt) }
          : { ...m, haberVes: m.haberVes.suma(linea.montoVes), haberUsd: m.haberUsd.suma(linea.montoUsdMgmt) },
      );
    }
  }

  return new Map([...acc.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Saldo neto en VES como saldo DEUDOR (ΣD − ΣH): positivo = saldo al debe. */
export function saldoDeudorVes(mov: MovimientoCuenta): Money {
  return mov.debeVes.resta(mov.haberVes);
}

/** Saldo neto en USD gerencial como saldo deudor (ΣD − ΣH). */
export function saldoDeudorUsd(mov: MovimientoCuenta): Money {
  return mov.debeUsd.resta(mov.haberUsd);
}

/**
 * Saldo en la orientación NORMAL de la cuenta (positivo = saldo normal): para cuentas deudoras
 * (Activo/Costo/Gasto) ΣD−ΣH; para acreedoras (Pasivo/Patrimonio/Ingreso) ΣH−ΣD.
 */
export function saldoEnNaturalezaVes(mov: MovimientoCuenta, naturaleza: NaturalezaCuenta): Money {
  return saldoNormal(naturaleza) === 'D'
    ? mov.debeVes.resta(mov.haberVes)
    : mov.haberVes.resta(mov.debeVes);
}

/** Fila del balance de comprobación. */
export interface FilaBalanceComprobacion {
  readonly cuenta: string;
  readonly naturaleza?: NaturalezaCuenta;
  readonly debeVes: Money;
  readonly haberVes: Money;
  readonly saldoDeudorVes: Money;
}

export interface BalanceDeComprobacion {
  readonly filas: ReadonlyArray<FilaBalanceComprobacion>;
  readonly totalDebeVes: Money;
  readonly totalHaberVes: Money;
  /** Invariante: el total del debe iguala al del haber (docs/05 §7.1). */
  readonly cuadra: boolean;
}

/**
 * Balance de comprobación en base VES a partir de los asientos POSTED. Si se pasa el `plan`,
 * anota la naturaleza de cada cuenta. El total del debe DEBE igualar al del haber (consecuencia
 * de que cada asiento cuadra).
 */
export function balanceDeComprobacion(
  asientos: ReadonlyArray<Asiento>,
  opciones: { plan?: PlanDeCuentas } = {},
): BalanceDeComprobacion {
  const mayor = calcularMayor(asientos);
  let totalDebe = Money.cero(MONEDA_VES);
  let totalHaber = Money.cero(MONEDA_VES);
  const filas: FilaBalanceComprobacion[] = [];

  for (const mov of mayor.values()) {
    totalDebe = totalDebe.suma(mov.debeVes);
    totalHaber = totalHaber.suma(mov.haberVes);
    const naturaleza = opciones.plan?.cuenta(mov.cuenta)?.naturaleza;
    filas.push({
      cuenta: mov.cuenta,
      ...(naturaleza !== undefined ? { naturaleza } : {}),
      debeVes: mov.debeVes,
      haberVes: mov.haberVes,
      saldoDeudorVes: saldoDeudorVes(mov),
    });
  }

  return {
    filas,
    totalDebeVes: totalDebe,
    totalHaberVes: totalHaber,
    cuadra: totalDebe.igualA(totalHaber),
  };
}
