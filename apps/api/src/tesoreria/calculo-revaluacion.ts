import {
  balancearConRedondeo,
  CUENTA_GANANCIA_CAMBIARIA,
  CUENTA_PERDIDA_CAMBIARIA,
  type EntradaAsiento,
  type EntradaLinea,
} from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO de la revaluación mensual de saldos en divisas (docs/03 §4.2 "no realizado", caso 11).
 * Sin IO: 100% testeable. Al cierre de mes, cada saldo en divisas (caja USD, Zelle, USDT, bancos
 * divisa, CxC/CxP en divisas) se revalúa a la **tasa BCV de cierre**: el diferencial NO realizado se
 * lleva a 4.7 (ganancia) / 6.7 (pérdida) y la cuenta del saldo se ajusta en su base VES.
 *
 * Sólo cambia la **expresión en VES** del saldo (el monto en divisa no varía); por eso las líneas son
 * de AJUSTE con `montoOrigen=0` y la base gerencial USD intacta (`montoUsdMgmt=0`): el asiento es un
 * efecto puramente VES, balanceado contra la cuenta de diferencial. El servicio postea este asiento
 * el último día del mes y su **reverso** el día 1 del mes siguiente; la idempotencia (re-ejecutar no
 * duplica) la garantiza la unicidad `(company, anio, mes)` en `revaluaciones`.
 */

const DEC2 = 2;

function r2(d: Decimal): string {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2);
}

/** Saldo en divisas a revaluar (uno por cuenta del plan). */
export interface SaldoDivisa {
  /** Código de la cuenta del plan (caja USD, banco divisa, CxC/CxP divisas, …). */
  readonly cuenta: string;
  readonly moneda: string;
  /** Lado del saldo normal: 'D' activo (caja/banco/CxC) | 'C' pasivo (CxP). */
  readonly lado: 'D' | 'C';
  /** Magnitud del saldo en moneda origen (divisa), positiva. */
  readonly saldoOrigen: string;
  /** Valor VES con el que el saldo está registrado en libros (positivo). */
  readonly vesEnLibros: string;
}

export interface EntradaRevaluacion {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly saldos: ReadonlyArray<SaldoDivisa>;
  /** Tasa BCV de cierre (Bs/divisa). */
  readonly rateCierre: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

export interface ResultadoRevaluacion {
  /** Diferencial NO realizado total en VES (firmado: + ganancia / − pérdida). */
  readonly diferencialVes: string;
  /** Asiento de ajuste; undefined si el diferencial neto es ≤ céntimo. */
  readonly entradaAsiento?: EntradaAsiento;
}

export function calcularRevaluacion(entrada: EntradaRevaluacion): ResultadoRevaluacion {
  const rateCierre = new Decimal(entrada.rateCierre);
  if (!rateCierre.isFinite() || rateCierre.lte(0)) {
    throw new Error('calcularRevaluacion: rateCierre debe ser > 0');
  }

  const lineas: EntradaLinea[] = [];
  let diferencialNeto = new Decimal(0);

  for (const s of entrada.saldos) {
    const moneda = s.moneda.trim().toUpperCase();
    if (moneda === 'VES') continue; // los saldos en Bs no se revalúan (son monetarios en su moneda).
    const nuevoVes = new Decimal(s.saldoOrigen).times(rateCierre);
    const ajuste = nuevoVes.minus(s.vesEnLibros); // Δ en la expresión VES del saldo.
    if (ajuste.abs().lte('0.01')) continue;

    // El saldo crece en VES (ajuste>0): va a su lado NORMAL (activo→debe, pasivo→haber); decrece: opuesto.
    const crece = ajuste.isPositive();
    const dcSaldo = crece ? s.lado : s.lado === 'D' ? 'C' : 'D';
    lineas.push({
      cuenta: s.cuenta,
      dc: dcSaldo,
      moneda: moneda as never,
      montoOrigen: '0',
      montoVes: r2(ajuste.abs()),
      montoUsdMgmt: '0',
      esAjuste: true,
    });

    // Efecto en resultado: activo que crece o pasivo que decrece → ganancia; lo contrario → pérdida.
    const esGanancia = s.lado === 'D' ? crece : !crece;
    diferencialNeto = diferencialNeto.plus(esGanancia ? ajuste.abs() : ajuste.abs().negated());
    lineas.push({
      cuenta: esGanancia ? CUENTA_GANANCIA_CAMBIARIA : CUENTA_PERDIDA_CAMBIARIA,
      dc: esGanancia ? 'C' : 'D',
      moneda: 'VES' as never,
      montoOrigen: r2(ajuste.abs()),
      montoVes: r2(ajuste.abs()),
      montoUsdMgmt: '0',
      esAjuste: true,
    });
  }

  if (lineas.length === 0) {
    return { diferencialVes: '0.00' };
  }

  return {
    diferencialVes: r2(diferencialNeto),
    entradaAsiento: {
      fecha: entrada.fecha,
      descripcion: entrada.descripcion,
      lineas: balancearConRedondeo(lineas),
      sourceType: 'REVALUACION',
      estado: 'DRAFT',
      ...(entrada.companyId !== undefined ? { companyId: entrada.companyId } : {}),
      ...(entrada.sourceId !== undefined ? { sourceId: entrada.sourceId } : {}),
    },
  };
}
