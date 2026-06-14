import { balancearConRedondeo, type EntradaAsiento, type EntradaLinea } from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO del arqueo de un cierre de caja (docs/06 M1 POS / M4, caso 5). Sin IO: 100% testeable.
 * Compara, por método de pago, lo **esperado por el sistema** (derivado de los movimientos reales del
 * turno — que ya distinguen método, incluido el vuelto cruzado del caso 5) contra lo **declarado**
 * (conteo físico del cajero). La diferencia por método ajusta la cuenta de caja del método a la
 * realidad y va a **faltantes** (gasto 6.5) o **sobrantes** (otros ingresos 4.6).
 *
 * `diferencia = declarado − sistema` (firmado: + sobrante / − faltante). Si no hay diferencias, no
 * hay asiento (`entradaAsiento` undefined): el cierre se registra sin movimiento contable.
 */

const DEC2 = 2;

/** Cuenta de faltantes de caja: gasto NO deducible (sin soporte → conciliación fiscal ISLR). */
export const CUENTA_FALTANTE = '6.8';
/** Cuenta de sobrantes de caja (otros ingresos). */
export const CUENTA_SOBRANTE = '4.6';

function r2(d: Decimal): string {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2);
}

/** Conteo de un método de pago en el cierre. */
export interface ConteoMetodo {
  readonly paymentMethodId: string;
  /** Código de la cuenta de caja/banco del método. */
  readonly cuenta: string;
  readonly moneda: string;
  /** Esperado por el sistema, en la moneda del método. */
  readonly montoSistema: string;
  /** Declarado (arqueo físico), en la moneda del método. */
  readonly montoDeclarado: string;
  /** Tasa BCV de la fecha del cierre para la moneda (null si VES). */
  readonly rateBcv: string | null;
}

export interface EntradaArqueo {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly conteos: ReadonlyArray<ConteoMetodo>;
  readonly rateUsdMgmt: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/** Diferencia calculada de un método. */
export interface DiferenciaMetodo {
  readonly paymentMethodId: string;
  readonly moneda: string;
  readonly montoSistema: string;
  readonly montoDeclarado: string;
  /** declarado − sistema en la moneda del método (firmado). */
  readonly diferencia: string;
  /** Equivalente en VES (firmado). */
  readonly diferenciaVes: string;
}

export interface ResultadoArqueo {
  readonly diferencias: ReadonlyArray<DiferenciaMetodo>;
  /** Suma de las diferencias en VES (firmado: + sobrante neto / − faltante neto). */
  readonly totalDiferenciaVes: string;
  /** Asiento de ajuste; undefined si no hubo diferencias. */
  readonly entradaAsiento?: EntradaAsiento;
}

function vesDe(monto: Decimal, moneda: string, rateBcv: Decimal | null): Decimal {
  return moneda.trim().toUpperCase() === 'VES' ? monto : monto.times(rateBcv ?? new Decimal(0));
}

export function calcularArqueo(entrada: EntradaArqueo): ResultadoArqueo {
  const rateUsdMgmt = new Decimal(entrada.rateUsdMgmt);
  if (!rateUsdMgmt.isFinite() || rateUsdMgmt.lte(0)) {
    throw new Error('calcularArqueo: rateUsdMgmt debe ser > 0');
  }

  const diferencias: DiferenciaMetodo[] = [];
  const lineas: EntradaLinea[] = [];
  let totalDiferenciaVes = new Decimal(0);

  for (const c of entrada.conteos) {
    const moneda = c.moneda.trim().toUpperCase();
    const rateBcv = c.rateBcv === null ? null : new Decimal(c.rateBcv);
    const diferencia = new Decimal(c.montoDeclarado).minus(c.montoSistema);
    const diferenciaVes = vesDe(diferencia, moneda, rateBcv);
    diferencias.push({
      paymentMethodId: c.paymentMethodId,
      moneda,
      montoSistema: c.montoSistema,
      montoDeclarado: c.montoDeclarado,
      diferencia: r2(diferencia),
      diferenciaVes: r2(diferenciaVes),
    });
    totalDiferenciaVes = totalDiferenciaVes.plus(diferenciaVes);

    if (diferencia.abs().lte('0.0000001')) continue;
    const abs = diferencia.abs();
    const ves = diferenciaVes.abs();
    const usd = moneda === 'USD' ? abs : ves.div(rateUsdMgmt);
    const esSobrante = diferencia.isPositive();
    // Sobrante: hay más efectivo que el sistema → D caja, C 4.6. Faltante: menos → C caja, D 6.5.
    lineas.push({
      cuenta: c.cuenta,
      dc: esSobrante ? 'D' : 'C',
      moneda: moneda as never,
      montoOrigen: r2(abs),
      montoVes: r2(ves),
      montoUsdMgmt: r2(usd),
      ...(rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {}),
      rateUsdMgmt: rateUsdMgmt.toFixed(),
    });
    lineas.push({
      cuenta: esSobrante ? CUENTA_SOBRANTE : CUENTA_FALTANTE,
      dc: esSobrante ? 'C' : 'D',
      moneda: moneda as never,
      montoOrigen: r2(abs),
      montoVes: r2(ves),
      montoUsdMgmt: r2(usd),
      ...(rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {}),
      rateUsdMgmt: rateUsdMgmt.toFixed(),
    });
  }

  if (lineas.length === 0) {
    return { diferencias, totalDiferenciaVes: r2(totalDiferenciaVes) };
  }

  return {
    diferencias,
    totalDiferenciaVes: r2(totalDiferenciaVes),
    entradaAsiento: {
      fecha: entrada.fecha,
      descripcion: entrada.descripcion,
      lineas: balancearConRedondeo(lineas),
      sourceType: 'CIERRE_CAJA',
      estado: 'DRAFT',
      ...(entrada.companyId !== undefined ? { companyId: entrada.companyId } : {}),
      ...(entrada.sourceId !== undefined ? { sourceId: entrada.sourceId } : {}),
    },
  };
}
