import { balancearConRedondeo, type EntradaAsiento, type EntradaLinea } from '@contave/ledger';
import { Decimal, type InstanteUtc } from '@contave/shared';

/**
 * Constructores PUROS de los asientos del módulo de inventario (docs/03 §4.3 "inventario en doble
 * base", §5 inventario permanente). Sin IO: 100% testeables. La UI/servicio nunca arma cuentas a
 * mano; usa estos builders. Los montos llegan ya valorados (costo promedio) en doble base.
 *
 * Cuentas (plan base, docs/03 §2):
 *  1.4 Inventarios · 5.1 Costo de ventas · 4.6 Otros ingresos (sobrantes) ·
 *  6.3 Gastos de venta (merma deducible) · 6.8 Gastos no deducibles (merma sin soporte, caso 40).
 */

export const CUENTA_INVENTARIO = '1.4';
export const CUENTA_COSTO_VENTA = '5.1';
export const CUENTA_OTROS_INGRESOS = '4.6';
export const CUENTA_MERMA_DEDUCIBLE = '6.3';
export const CUENTA_GASTO_NO_DEDUCIBLE = '6.8';

const DEC8 = 8;

/** Las valuaciones de inventario no tienen "moneda origen": se asientan con origen = VES (= base fiscal). */
function lineaInventario(cuenta: string, dc: 'D' | 'C', ves: string, usd: string): EntradaLinea {
  return {
    cuenta,
    dc,
    moneda: 'VES',
    montoOrigen: ves,
    montoVes: ves,
    montoUsdMgmt: usd,
  };
}

/** Costo de un movimiento valorado en doble base (Bs/USD). */
export interface CostoValuado {
  readonly ves: string;
  readonly usd: string;
}

export interface AsientoCostoVentaInput {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly costo: CostoValuado;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/**
 * Asiento del COSTO DE VENTA (inventario permanente): D 5.1 Costo de ventas / C 1.4 Inventarios, por
 * el costo promedio de lo despachado. Devuelve `undefined` si el costo es ≤ 0 (servicio sin stock
 * valorado, p. ej. venta en negativo con costo 0 — caso 38).
 */
export function armarAsientoCostoVenta(e: AsientoCostoVentaInput): EntradaAsiento | undefined {
  if (new Decimal(e.costo.ves).lte(0) && new Decimal(e.costo.usd).lte(0)) {
    return undefined;
  }
  const lineas: EntradaLinea[] = [
    lineaInventario(CUENTA_COSTO_VENTA, 'D', e.costo.ves, e.costo.usd),
    lineaInventario(CUENTA_INVENTARIO, 'C', e.costo.ves, e.costo.usd),
  ];
  return {
    fecha: e.fecha,
    descripcion: e.descripcion,
    lineas: balancearConRedondeo(lineas),
    sourceType: 'COSTO_VENTA',
    estado: 'DRAFT',
    ...(e.companyId !== undefined ? { companyId: e.companyId } : {}),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
  };
}

export interface AsientoEntradaInput {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly costo: CostoValuado;
  /** Cuenta de contrapartida del crédito (proveedores, caja, capital de apertura…). */
  readonly cuentaContrapartida: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/**
 * Asiento de una ENTRADA de inventario (compra/apertura): D 1.4 Inventarios / C contrapartida. El
 * costo llega ya en doble base. Lo usan la entrada manual y la apertura de saldos.
 */
export function armarAsientoEntrada(e: AsientoEntradaInput): EntradaAsiento | undefined {
  if (new Decimal(e.costo.ves).lte(0) && new Decimal(e.costo.usd).lte(0)) {
    return undefined;
  }
  const lineas: EntradaLinea[] = [
    lineaInventario(CUENTA_INVENTARIO, 'D', e.costo.ves, e.costo.usd),
    lineaInventario(e.cuentaContrapartida, 'C', e.costo.ves, e.costo.usd),
  ];
  return {
    fecha: e.fecha,
    descripcion: e.descripcion,
    lineas: balancearConRedondeo(lineas),
    sourceType: 'INVENTARIO_ENTRADA',
    estado: 'DRAFT',
    ...(e.companyId !== undefined ? { companyId: e.companyId } : {}),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
  };
}

/** Una línea de ajuste ya valorada (dirección + costo en doble base). */
export interface LineaAjusteValuada {
  readonly direccion: 'ENTRADA' | 'SALIDA';
  readonly valorVes: string;
  readonly valorUsd: string;
}

export interface AsientoAjusteInput {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly lineas: ReadonlyArray<LineaAjusteValuada>;
  /** Merma deducible (6.3) vs no deducible (6.8) — flag de conciliación fiscal (caso 40). */
  readonly deducible: boolean;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/**
 * Asiento de un AJUSTE de inventario (merma/robo/sobrante; caso 40). Por cada línea:
 *  - SALIDA (merma/robo): D gasto (6.3 deducible / 6.8 no deducible) / C 1.4 Inventarios.
 *  - ENTRADA (sobrante): D 1.4 Inventarios / C 4.6 Otros ingresos.
 * Devuelve `undefined` si el valor neto es nulo. El gasto/ingreso se consolida en una sola línea por
 * cuenta para un asiento limpio.
 */
export function armarAsientoAjuste(e: AsientoAjusteInput): EntradaAsiento | undefined {
  const cuentaGasto = e.deducible ? CUENTA_MERMA_DEDUCIBLE : CUENTA_GASTO_NO_DEDUCIBLE;
  let invD = new Decimal(0); // débitos a inventario (entradas)
  let invDUsd = new Decimal(0);
  let invC = new Decimal(0); // créditos a inventario (salidas)
  let invCUsd = new Decimal(0);
  let gasto = new Decimal(0);
  let gastoUsd = new Decimal(0);
  let ingreso = new Decimal(0);
  let ingresoUsd = new Decimal(0);

  for (const l of e.lineas) {
    if (l.direccion === 'SALIDA') {
      invC = invC.plus(l.valorVes);
      invCUsd = invCUsd.plus(l.valorUsd);
      gasto = gasto.plus(l.valorVes);
      gastoUsd = gastoUsd.plus(l.valorUsd);
    } else {
      invD = invD.plus(l.valorVes);
      invDUsd = invDUsd.plus(l.valorUsd);
      ingreso = ingreso.plus(l.valorVes);
      ingresoUsd = ingresoUsd.plus(l.valorUsd);
    }
  }

  const lineas: EntradaLinea[] = [];
  if (gasto.gt(0)) {
    lineas.push(lineaInventario(cuentaGasto, 'D', gasto.toFixed(DEC8), gastoUsd.toFixed(DEC8)));
    lineas.push(lineaInventario(CUENTA_INVENTARIO, 'C', invC.toFixed(DEC8), invCUsd.toFixed(DEC8)));
  }
  if (ingreso.gt(0)) {
    lineas.push(lineaInventario(CUENTA_INVENTARIO, 'D', invD.toFixed(DEC8), invDUsd.toFixed(DEC8)));
    lineas.push(
      lineaInventario(CUENTA_OTROS_INGRESOS, 'C', ingreso.toFixed(DEC8), ingresoUsd.toFixed(DEC8)),
    );
  }
  if (lineas.length === 0) {
    return undefined;
  }
  return {
    fecha: e.fecha,
    descripcion: e.descripcion,
    lineas: balancearConRedondeo(lineas),
    sourceType: 'AJUSTE_INVENTARIO',
    estado: 'DRAFT',
    ...(e.companyId !== undefined ? { companyId: e.companyId } : {}),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
  };
}
