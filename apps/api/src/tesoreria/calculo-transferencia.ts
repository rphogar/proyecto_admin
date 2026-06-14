import {
  balancearConRedondeo,
  CUENTA_GANANCIA_CAMBIARIA,
  CUENTA_PERDIDA_CAMBIARIA,
  type EntradaAsiento,
  type EntradaLinea,
} from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO de una transferencia interna entre dos cuentas propias (docs/06 M4, docs/03 §4.2).
 * Sin IO: 100% testeable. Arma el asiento en triple base: **D cuenta destino / C cuenta origen**.
 *
 * Cuando las monedas difieren (conversión: comprar/vender divisas, mover Bs↔USD) cada pata se valora
 * en VES a su propia tasa; si el valor en VES recibido difiere del entregado surge un **diferencial
 * cambiario realizado** (4.7 ganancia / 6.7 pérdida) que se registra como línea de AJUSTE, jamás se
 * absorbe en redondeos (regla 11). La base gerencial USD se concilia por separado (otra línea de
 * ajuste) para no descuadrar cuando la tasa gerencial difiere de la BCV. El residuo ≤ céntimo lo
 * afina {@link balancearConRedondeo}.
 *
 * TODO-TRIBUTARISTA: clasificación realizado/no realizado del diferencial para la conciliación ISLR
 * (docs/03 §4.2); aquí se registra el efecto en VES (4.7/6.7).
 */

const DEC2 = 2;

function r2(d: Decimal): string {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2);
}

/** Una pata de la transferencia (origen o destino). */
export interface PataTransferencia {
  /** Código de la cuenta contable (caja/banco) del plan. */
  readonly cuenta: string;
  readonly moneda: string;
  readonly monto: string;
  /** Tasa BCV de la fecha (Bs por unidad de `moneda`); null si `moneda`=VES. */
  readonly rateBcv: string | null;
}

export interface EntradaTransferencia {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly origen: PataTransferencia;
  readonly destino: PataTransferencia;
  /** Tasa gerencial Bs/USD de la fecha. */
  readonly rateUsdMgmt: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

export interface ResultadoTransferencia {
  /** Diferencial cambiario en VES (firmado: + ganancia / − pérdida). */
  readonly diferencialVes: string;
  readonly entradaAsiento: EntradaAsiento;
}

interface Triple {
  origen: Decimal;
  ves: Decimal;
  usd: Decimal;
}

function expandir(monto: Decimal, moneda: string, rateBcv: Decimal | null, rateUsdMgmt: Decimal): Triple {
  const m = moneda.trim().toUpperCase();
  if (m !== 'VES' && rateBcv === null) {
    throw new Error(`calcularTransferencia: falta rateBcv para ${m}`);
  }
  const ves = m === 'VES' ? monto : monto.times(rateBcv as Decimal);
  const usd = m === 'USD' ? monto : ves.div(rateUsdMgmt);
  return { origen: monto, ves, usd };
}

function linea(
  dc: 'D' | 'C',
  cuenta: string,
  moneda: string,
  t: Triple,
  rateBcv: Decimal | null,
  rateUsdMgmt: Decimal,
  esConversion: boolean,
): EntradaLinea {
  return {
    cuenta,
    dc,
    moneda: moneda as never,
    montoOrigen: r2(t.origen),
    montoVes: r2(t.ves),
    montoUsdMgmt: r2(t.usd),
    ...(rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {}),
    rateUsdMgmt: rateUsdMgmt.toFixed(),
    // En una conversión las dos patas están en monedas distintas: el cuadre por moneda origen no
    // puede cumplirse (sale VES, entra USD), así que se marcan AJUSTE (excluidas de ese cuadre, como
    // el swap de divisas del vuelto cruzado en calculo-cobro). Las bases VES/USD sí deben cuadrar.
    ...(esConversion ? { esAjuste: true } : {}),
  };
}

/** Línea de ajuste de una sola base (VES o USD); la otra va en 0. Excluida del cuadre por origen. */
function lineaAjuste(dc: 'D' | 'C', cuenta: string, base: 'VES' | 'USD', monto: Decimal): EntradaLinea {
  return {
    cuenta,
    dc,
    moneda: base as never,
    montoOrigen: base === 'USD' ? r2(monto) : r2(monto),
    montoVes: base === 'VES' ? r2(monto) : '0',
    montoUsdMgmt: base === 'USD' ? r2(monto) : '0',
    esAjuste: true,
  };
}

export function calcularTransferencia(entrada: EntradaTransferencia): ResultadoTransferencia {
  const rateUsdMgmt = new Decimal(entrada.rateUsdMgmt);
  if (!rateUsdMgmt.isFinite() || rateUsdMgmt.lte(0)) {
    throw new Error('calcularTransferencia: rateUsdMgmt debe ser > 0');
  }
  if (entrada.origen.cuenta === entrada.destino.cuenta) {
    throw new Error('calcularTransferencia: origen y destino no pueden ser la misma cuenta');
  }

  const rOrigen = entrada.origen.rateBcv === null ? null : new Decimal(entrada.origen.rateBcv);
  const rDestino = entrada.destino.rateBcv === null ? null : new Decimal(entrada.destino.rateBcv);
  const tOrigen = expandir(new Decimal(entrada.origen.monto), entrada.origen.moneda, rOrigen, rateUsdMgmt);
  const tDestino = expandir(new Decimal(entrada.destino.monto), entrada.destino.moneda, rDestino, rateUsdMgmt);
  const esConversion = entrada.origen.moneda.trim().toUpperCase() !== entrada.destino.moneda.trim().toUpperCase();

  const lineas: EntradaLinea[] = [
    linea('C', entrada.origen.cuenta, entrada.origen.moneda, tOrigen, rOrigen, rateUsdMgmt, esConversion),
    linea('D', entrada.destino.cuenta, entrada.destino.moneda, tDestino, rDestino, rateUsdMgmt, esConversion),
  ];

  // Diferencial = ΣD − ΣC en cada base (lo recibido menos lo entregado). Una línea por base para no
  // descuadrar cuando la tasa gerencial difiere de la BCV.
  const residualVes = tDestino.ves.minus(tOrigen.ves);
  const residualUsd = tDestino.usd.minus(tOrigen.usd);

  if (residualVes.abs().gt('0.01')) {
    const esGanancia = residualVes.isPositive();
    lineas.push(lineaAjuste(esGanancia ? 'C' : 'D', esGanancia ? CUENTA_GANANCIA_CAMBIARIA : CUENTA_PERDIDA_CAMBIARIA, 'VES', residualVes.abs()));
  }
  if (residualUsd.abs().gt('0.01')) {
    const esGanancia = residualUsd.isPositive();
    lineas.push(lineaAjuste(esGanancia ? 'C' : 'D', esGanancia ? CUENTA_GANANCIA_CAMBIARIA : CUENTA_PERDIDA_CAMBIARIA, 'USD', residualUsd.abs()));
  }

  const balanceadas = balancearConRedondeo(lineas);

  return {
    diferencialVes: r2(residualVes),
    entradaAsiento: {
      fecha: entrada.fecha,
      descripcion: entrada.descripcion,
      lineas: balanceadas,
      sourceType: 'TRANSFERENCIA',
      estado: 'DRAFT',
      ...(entrada.companyId !== undefined ? { companyId: entrada.companyId } : {}),
      ...(entrada.sourceId !== undefined ? { sourceId: entrada.sourceId } : {}),
    },
  };
}
