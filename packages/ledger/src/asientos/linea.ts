import { type CodigoMoneda, Decimal, Money, type MoneyInput } from '@contave/shared';
import type { Lado } from '../cuentas/naturaleza';

/** Código de moneda de la base fiscal (siempre VES) y la base gerencial (siempre USD). */
export const MONEDA_VES: CodigoMoneda = 'VES';
export const MONEDA_USD_MGMT: CodigoMoneda = 'USD';

/**
 * Entrada para construir una línea de asiento (docs/03 §4, regla 10 de CLAUDE.md). Cada línea
 * guarda el mismo monto en TRES expresiones: moneda origen, base fiscal VES y base gerencial USD.
 */
export interface EntradaLinea {
  /** Código de la cuenta imputada (debe ser de movimiento; lo valida el posting con el plan). */
  readonly cuenta: string;
  /** Lado: débito o crédito. */
  readonly dc: Lado;
  /** Moneda de la operación de esta línea. */
  readonly moneda: CodigoMoneda;
  /** Monto en moneda origen (≥ 0). */
  readonly montoOrigen: MoneyInput;
  /** Monto en base fiscal VES (≥ 0) — la verdad legal. */
  readonly montoVes: MoneyInput;
  /** Monto en base gerencial USD (≥ 0). */
  readonly montoUsdMgmt: MoneyInput;
  /** Tasa BCV congelada de la operación (informativa). */
  readonly rateBcv?: string | number | Decimal | null;
  /** Tasa gerencial usada (informativa). */
  readonly rateUsdMgmt?: string | number | Decimal | null;
  /**
   * Línea de AJUSTE (diferencial cambiario o redondeo): existe para reconciliar una base
   * (VES o USD), no el origen. Se EXCLUYE del cuadre por moneda origen (docs/03 §4.2).
   */
  readonly esAjuste?: boolean;
  readonly partyId?: string;
  readonly centroCosto?: string;
  readonly sucursalId?: string;
  /** Fecha de vencimiento (CxC/CxP), ISO `YYYY-MM-DD`. */
  readonly vencimiento?: string;
}

/**
 * Línea de asiento resuelta: montos como `Money` tipados por moneda (regla 1: nunca floats).
 * Inmutable.
 */
export class LineaAsiento {
  readonly cuenta: string;
  readonly dc: Lado;
  readonly moneda: CodigoMoneda;
  readonly montoOrigen: Money;
  readonly montoVes: Money;
  readonly montoUsdMgmt: Money;
  readonly rateBcv: Decimal | null;
  readonly rateUsdMgmt: Decimal | null;
  readonly esAjuste: boolean;
  readonly partyId: string | undefined;
  readonly centroCosto: string | undefined;
  readonly sucursalId: string | undefined;
  readonly vencimiento: string | undefined;

  private constructor(props: {
    cuenta: string;
    dc: Lado;
    moneda: CodigoMoneda;
    montoOrigen: Money;
    montoVes: Money;
    montoUsdMgmt: Money;
    rateBcv: Decimal | null;
    rateUsdMgmt: Decimal | null;
    esAjuste: boolean;
    partyId: string | undefined;
    centroCosto: string | undefined;
    sucursalId: string | undefined;
    vencimiento: string | undefined;
  }) {
    this.cuenta = props.cuenta;
    this.dc = props.dc;
    this.moneda = props.moneda;
    this.montoOrigen = props.montoOrigen;
    this.montoVes = props.montoVes;
    this.montoUsdMgmt = props.montoUsdMgmt;
    this.rateBcv = props.rateBcv;
    this.rateUsdMgmt = props.rateUsdMgmt;
    this.esAjuste = props.esAjuste;
    this.partyId = props.partyId;
    this.centroCosto = props.centroCosto;
    this.sucursalId = props.sucursalId;
    this.vencimiento = props.vencimiento;
    Object.freeze(this);
  }

  static desde(entrada: EntradaLinea): LineaAsiento {
    if (entrada.dc !== 'D' && entrada.dc !== 'C') {
      throw new Error(`Lado inválido en línea de "${entrada.cuenta}": ${String(entrada.dc)}`);
    }
    const montoOrigen = Money.of(entrada.montoOrigen, entrada.moneda);
    const montoVes = Money.of(entrada.montoVes, MONEDA_VES);
    const montoUsdMgmt = Money.of(entrada.montoUsdMgmt, MONEDA_USD_MGMT);

    for (const [nombre, m] of [
      ['origen', montoOrigen],
      ['VES', montoVes],
      ['USD', montoUsdMgmt],
    ] as const) {
      if (m.esNegativo()) {
        throw new Error(
          `Monto ${nombre} negativo en línea de "${entrada.cuenta}": ${m.toString()}. ` +
            `Usa el lado D/C para el signo, no montos negativos.`,
        );
      }
    }

    return new LineaAsiento({
      cuenta: entrada.cuenta,
      dc: entrada.dc,
      moneda: montoOrigen.moneda,
      montoOrigen,
      montoVes,
      montoUsdMgmt,
      rateBcv: entrada.rateBcv == null ? null : new Decimal(entrada.rateBcv),
      rateUsdMgmt: entrada.rateUsdMgmt == null ? null : new Decimal(entrada.rateUsdMgmt),
      esAjuste: entrada.esAjuste ?? false,
      partyId: entrada.partyId,
      centroCosto: entrada.centroCosto,
      sucursalId: entrada.sucursalId,
      vencimiento: entrada.vencimiento,
    });
  }

  /** Monto en la base fiscal (VES) o gerencial (USD). */
  montoEnBase(base: 'VES' | 'USD'): Money {
    return base === 'VES' ? this.montoVes : this.montoUsdMgmt;
  }
}
