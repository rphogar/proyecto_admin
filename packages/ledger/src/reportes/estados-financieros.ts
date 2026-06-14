import { Money } from '@contave/shared';
import { MONEDA_USD_MGMT, MONEDA_VES } from '../asientos/linea';
import { claseDeCodigo, codigoPadre } from '../cuentas/codigo';
import type { PlanDeCuentas } from '../cuentas/plan-de-cuentas';
import { type NaturalezaCuenta, naturalezaDeClase, saldoNormal } from '../cuentas/naturaleza';
import type { MovimientoCuenta } from '../saldos/saldos';

/**
 * Estados financieros puros en doble base (VES fiscal + USD gerencial) — P13, docs/03 §5–6.
 * Se construyen sobre los movimientos por cuenta ya agregados (en la API los provee SQL sobre
 * `journal_lines` POSTED). El rollup respeta la jerarquía del plan (`codigo_padre`/nivel) y la
 * naturaleza por clase del código (1=Activo…6=Gasto), presentando cada cuenta en su orientación
 * NORMAL (saldo deudor positivo para Activo/Costo/Gasto; acreedor positivo para
 * Pasivo/Patrimonio/Ingreso). Drill-down y bases reexpresadas (NIC 29) se resuelven fuera.
 *
 * Por ahora se entregan Estado de Resultados y Estado de Situación Financiera.
 * TODO-CONTADOR: Flujo de Efectivo (indirecto) y Estado de Cambios en el Patrimonio.
 * TODO-TRIBUTARISTA: tercera base "Bs reexpresados" (NIC 29).
 */

/** Saldo de una cuenta en ambas bases (orientación normal). */
export interface SaldoDobleBase {
  readonly ves: Money;
  readonly usd: Money;
}

/** Nodo del árbol de un estado financiero (cuenta + saldo en naturaleza + subcuentas). */
export interface NodoEstado {
  readonly cuenta: string;
  readonly nombre: string;
  readonly nivel: number;
  readonly naturaleza: NaturalezaCuenta;
  readonly esMovimiento: boolean;
  readonly saldoVes: Money;
  readonly saldoUsd: Money;
  readonly hijos: ReadonlyArray<NodoEstado>;
}

export interface EstadoResultados {
  readonly ingresos: ReadonlyArray<NodoEstado>;
  readonly costos: ReadonlyArray<NodoEstado>;
  readonly gastos: ReadonlyArray<NodoEstado>;
  readonly totalIngresosVes: Money;
  readonly totalIngresosUsd: Money;
  readonly totalCostosVes: Money;
  readonly totalCostosUsd: Money;
  readonly totalGastosVes: Money;
  readonly totalGastosUsd: Money;
  /** Resultado del período = Ingresos − (Costos + Gastos). */
  readonly utilidadVes: Money;
  readonly utilidadUsd: Money;
}

export interface EstadoSituacion {
  readonly activo: ReadonlyArray<NodoEstado>;
  readonly pasivo: ReadonlyArray<NodoEstado>;
  readonly patrimonio: ReadonlyArray<NodoEstado>;
  readonly totalActivoVes: Money;
  readonly totalActivoUsd: Money;
  readonly totalPasivoVes: Money;
  readonly totalPasivoUsd: Money;
  /** Patrimonio incluyendo el resultado del período aún no cerrado a 3.3/3.4. */
  readonly totalPatrimonioVes: Money;
  readonly totalPatrimonioUsd: Money;
  readonly resultadoDelPeriodoVes: Money;
  readonly resultadoDelPeriodoUsd: Money;
  /** Invariante contable: Activo = Pasivo + Patrimonio (+ resultado del período). */
  readonly cuadraVes: boolean;
  readonly cuadraUsd: boolean;
}

/** Naturaleza de una cuenta derivada de su código (clase = primer segmento). */
function naturalezaDe(codigo: string): NaturalezaCuenta {
  return naturalezaDeClase(claseDeCodigo(codigo));
}

/** Saldo de un movimiento en la orientación NORMAL de su naturaleza, en ambas bases. */
function saldoEnNaturaleza(mov: MovimientoCuenta): SaldoDobleBase {
  return saldoNormal(naturalezaDe(mov.cuenta)) === 'D'
    ? { ves: mov.debeVes.resta(mov.haberVes), usd: mov.debeUsd.resta(mov.haberUsd) }
    : { ves: mov.haberVes.resta(mov.debeVes), usd: mov.haberUsd.resta(mov.debeUsd) };
}

/**
 * Rollup jerárquico: a partir de los movimientos de las cuentas (hojas), acumula el saldo en
 * naturaleza de cada cuenta y de TODOS sus ancestros (`codigo_padre`). Devuelve el saldo doble
 * base por código para hojas y totalizadoras. Es puro y derivable solo del código (no necesita
 * el plan), por lo que es robusto ante cuentas a medida.
 */
export function rollupPorNivel(
  movimientos: ReadonlyArray<MovimientoCuenta>,
): Map<string, SaldoDobleBase> {
  const acc = new Map<string, SaldoDobleBase>();

  const sumar = (codigo: string, s: SaldoDobleBase): void => {
    const previo = acc.get(codigo);
    acc.set(
      codigo,
      previo === undefined
        ? s
        : { ves: previo.ves.suma(s.ves), usd: previo.usd.suma(s.usd) },
    );
  };

  for (const mov of movimientos) {
    const s = saldoEnNaturaleza(mov);
    // La cuenta y cada ancestro acumulan el mismo saldo en naturaleza (misma clase → misma
    // orientación, así que los contra-activos restan correctamente del total del padre).
    let codigo: string | null = mov.cuenta;
    while (codigo !== null) {
      sumar(codigo, s);
      codigo = codigoPadre(codigo);
    }
  }

  return acc;
}

/** Saldo doble base de un código en el rollup, o cero si no tuvo movimiento. */
function saldoDe(rollup: ReadonlyMap<string, SaldoDobleBase>, codigo: string): SaldoDobleBase {
  return rollup.get(codigo) ?? { ves: Money.cero(MONEDA_VES), usd: Money.cero(MONEDA_USD_MGMT) };
}

/**
 * Construye el subárbol de un código según el plan, anexando el saldo del rollup. Poda las ramas
 * sin movimiento (saldo ausente y sin hijos con movimiento) para no listar todo el catálogo.
 */
function construirNodo(
  codigo: string,
  plan: PlanDeCuentas,
  rollup: ReadonlyMap<string, SaldoDobleBase>,
): NodoEstado | null {
  const cuenta = plan.cuenta(codigo);
  if (cuenta === undefined) return null;

  const hijos = plan
    .hijos(codigo)
    .map((h) => construirNodo(h.codigo, plan, rollup))
    .filter((n): n is NodoEstado => n !== null);

  const tieneSaldo = rollup.has(codigo);
  if (!tieneSaldo && hijos.length === 0) return null;

  const saldo = saldoDe(rollup, codigo);
  return {
    cuenta: cuenta.codigo,
    nombre: cuenta.nombre,
    nivel: cuenta.nivel,
    naturaleza: cuenta.naturaleza,
    esMovimiento: cuenta.esMovimiento,
    saldoVes: saldo.ves,
    saldoUsd: saldo.usd,
    hijos,
  };
}

/** Nodos raíz (clases) presentes en el plan para una clase dada (1–6). */
function seccion(
  clase: number,
  plan: PlanDeCuentas,
  rollup: ReadonlyMap<string, SaldoDobleBase>,
): NodoEstado[] {
  return plan
    .raices()
    .filter((r) => claseDeCodigo(r.codigo) === clase)
    .map((r) => construirNodo(r.codigo, plan, rollup))
    .filter((n): n is NodoEstado => n !== null);
}

/** Total de una clase (saldo en naturaleza del/los nodo(s) raíz de esa clase). */
function totalClase(
  clase: number,
  plan: PlanDeCuentas,
  rollup: ReadonlyMap<string, SaldoDobleBase>,
): SaldoDobleBase {
  let ves = Money.cero(MONEDA_VES);
  let usd = Money.cero(MONEDA_USD_MGMT);
  for (const r of plan.raices()) {
    if (claseDeCodigo(r.codigo) !== clase) continue;
    const s = saldoDe(rollup, r.codigo);
    ves = ves.suma(s.ves);
    usd = usd.suma(s.usd);
  }
  return { ves, usd };
}

/**
 * Estado de Resultados: Ingresos (clase 4) − Costos (clase 5) − Gastos (clase 6), en doble base.
 */
export function estadoDeResultados(
  movimientos: ReadonlyArray<MovimientoCuenta>,
  plan: PlanDeCuentas,
): EstadoResultados {
  const rollup = rollupPorNivel(movimientos);
  const ingresos = totalClase(4, plan, rollup);
  const costos = totalClase(5, plan, rollup);
  const gastos = totalClase(6, plan, rollup);

  return {
    ingresos: seccion(4, plan, rollup),
    costos: seccion(5, plan, rollup),
    gastos: seccion(6, plan, rollup),
    totalIngresosVes: ingresos.ves,
    totalIngresosUsd: ingresos.usd,
    totalCostosVes: costos.ves,
    totalCostosUsd: costos.usd,
    totalGastosVes: gastos.ves,
    totalGastosUsd: gastos.usd,
    utilidadVes: ingresos.ves.resta(costos.ves).resta(gastos.ves),
    utilidadUsd: ingresos.usd.resta(costos.usd).resta(gastos.usd),
  };
}

/**
 * Estado de Situación Financiera: Activo (1) frente a Pasivo (2) + Patrimonio (3), en doble base.
 * El `resultadoDelPeriodo` (utilidad del Estado de Resultados) se suma al patrimonio porque aún
 * no se ha cerrado a 3.3/3.4; con él, el balance cuadra (Activo = Pasivo + Patrimonio).
 */
export function estadoDeSituacion(
  movimientos: ReadonlyArray<MovimientoCuenta>,
  plan: PlanDeCuentas,
  resultadoDelPeriodo: SaldoDobleBase,
): EstadoSituacion {
  const rollup = rollupPorNivel(movimientos);
  const activo = totalClase(1, plan, rollup);
  const pasivo = totalClase(2, plan, rollup);
  const patrimonio = totalClase(3, plan, rollup);

  const totalPatrimonioVes = patrimonio.ves.suma(resultadoDelPeriodo.ves);
  const totalPatrimonioUsd = patrimonio.usd.suma(resultadoDelPeriodo.usd);

  return {
    activo: seccion(1, plan, rollup),
    pasivo: seccion(2, plan, rollup),
    patrimonio: seccion(3, plan, rollup),
    totalActivoVes: activo.ves,
    totalActivoUsd: activo.usd,
    totalPasivoVes: pasivo.ves,
    totalPasivoUsd: pasivo.usd,
    totalPatrimonioVes,
    totalPatrimonioUsd,
    resultadoDelPeriodoVes: resultadoDelPeriodo.ves,
    resultadoDelPeriodoUsd: resultadoDelPeriodo.usd,
    cuadraVes: activo.ves.igualA(pasivo.ves.suma(totalPatrimonioVes)),
    cuadraUsd: activo.usd.igualA(pasivo.usd.suma(totalPatrimonioUsd)),
  };
}
