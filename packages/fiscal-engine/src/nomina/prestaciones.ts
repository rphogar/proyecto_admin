import { Decimal } from '@contave/shared';
import { aDecimalNoNeg, redondear } from './comun';

/**
 * Prestaciones sociales — DOBLE CÁLCULO del art. 142 LOTTT (docs/04 §2.3; caso 50). Al terminar la
 * relación se paga el MAYOR entre:
 *
 *  (a) Garantía: lo abonado trimestralmente (15 días de salario integral por trimestre) + los días
 *      adicionales (2 por año desde el 2.º, acumulativos hasta 30) + los intereses capitalizados a
 *      la tasa promedio BCV.  Estos montos provienen del kardex de prestaciones del trabajador.
 *  (c) Retroactivo: 30 días de salario por año de servicio al ÚLTIMO salario integral diario.
 *
 * Los anticipos (hasta 75%, art. 144) ya entregados se descuentan del monto a cancelar. Si el
 * despido es injustificado, el art. 92 ordena una indemnización adicional igual al monto de las
 * prestaciones (el "doblete").
 *
 * TODO-TRIBUTARISTA: confirmar (a) si la indemnización del art. 92 se calcula sobre el monto bruto
 * de prestaciones o el neto de anticipos, y (b) el redondeo de fracciones de año de antigüedad.
 */

export interface PrestacionesArt142Input {
  /** (a) Suma de los abonos trimestrales (15 días integral/trimestre) del kardex. */
  readonly garantiaAbonada: string | number;
  /** (a) Monto por días adicionales art. 142 (2/año desde el 2.º, tope 30) ya abonado. */
  readonly diasAdicionalesAbonados?: string | number;
  /** (a) Intereses sobre prestaciones capitalizados (tasa promedio BCV) del kardex. */
  readonly interesesAcumulados?: string | number;
  /** (c) Años de servicio (puede ser fraccionario). */
  readonly antiguedadAnios: string | number;
  /** (c) Último salario integral diario. */
  readonly salarioIntegralDiarioFinal: string | number;
  /** (c) Días por año del cálculo retroactivo (defecto 30; art. 142 lit. c). */
  readonly diasPorAnioRetroactivo?: number;
  /** Anticipos ya entregados que se descuentan del monto a pagar. */
  readonly adelantos?: string | number;
  /** Despido injustificado → indemnización art. 92 igual a las prestaciones. */
  readonly despidoInjustificado?: boolean;
  readonly decimales?: number;
}

export interface ResultadoPrestacionesArt142 {
  /** (a) Total de la vía garantía = abonos + días adicionales + intereses. */
  readonly viaGarantia: string;
  /** (c) Total de la vía retroactiva = antigüedad × díasPorAño × salario integral diario final. */
  readonly viaRetroactiva: string;
  /** Cuál vía resultó mayor (la que se paga, art. 142). */
  readonly baseMayor: 'GARANTIA' | 'RETROACTIVA';
  /** Monto de prestaciones (el mayor de las dos vías). */
  readonly prestaciones: string;
  /** Anticipos descontados. */
  readonly adelantos: string;
  /** Prestaciones a cancelar = max(0, prestaciones − adelantos). */
  readonly prestacionesACancelar: string;
  /** Indemnización art. 92 (= prestaciones si despido injustificado; si no, 0). */
  readonly indemnizacionArt92: string;
  /** Total a pagar al trabajador por prestaciones = prestacionesACancelar + indemnizacionArt92. */
  readonly totalAPagar: string;
}

export function calcularPrestacionesArt142(
  input: PrestacionesArt142Input,
): ResultadoPrestacionesArt142 {
  const dec = input.decimales ?? 2;

  const garantiaAbonada = aDecimalNoNeg(input.garantiaAbonada, 'garantiaAbonada');
  const diasAdicionales = aDecimalNoNeg(input.diasAdicionalesAbonados, 'diasAdicionalesAbonados', true);
  const intereses = aDecimalNoNeg(input.interesesAcumulados, 'interesesAcumulados', true);
  const antiguedad = aDecimalNoNeg(input.antiguedadAnios, 'antiguedadAnios');
  const integralDiarioFinal = aDecimalNoNeg(input.salarioIntegralDiarioFinal, 'salarioIntegralDiarioFinal');
  const diasPorAnio = new Decimal(input.diasPorAnioRetroactivo ?? 30);
  const adelantos = aDecimalNoNeg(input.adelantos, 'adelantos', true);

  const viaGarantia = garantiaAbonada.plus(diasAdicionales).plus(intereses);
  const viaRetroactiva = antiguedad.times(diasPorAnio).times(integralDiarioFinal);

  const retroMayor = viaRetroactiva.gt(viaGarantia);
  const prestaciones = retroMayor ? viaRetroactiva : viaGarantia;

  const aCancelarRaw = prestaciones.minus(adelantos);
  const prestacionesACancelar = aCancelarRaw.isNegative() ? new Decimal(0) : aCancelarRaw;

  const indemnizacion = input.despidoInjustificado ? prestaciones : new Decimal(0);
  const totalAPagar = prestacionesACancelar.plus(indemnizacion);

  return {
    viaGarantia: redondear(viaGarantia, dec).toFixed(dec),
    viaRetroactiva: redondear(viaRetroactiva, dec).toFixed(dec),
    baseMayor: retroMayor ? 'RETROACTIVA' : 'GARANTIA',
    prestaciones: redondear(prestaciones, dec).toFixed(dec),
    adelantos: redondear(adelantos, dec).toFixed(dec),
    prestacionesACancelar: redondear(prestacionesACancelar, dec).toFixed(dec),
    indemnizacionArt92: redondear(indemnizacion, dec).toFixed(dec),
    totalAPagar: redondear(totalAPagar, dec).toFixed(dec),
  };
}

export interface MovimientoInteres {
  readonly anio: number;
  /** Abono del año a la garantía (antes de calcular el interés del año). */
  readonly deposito: string | number;
  /** Tasa anual promedio BCV del año, en % (p.ej. 10 = 10%). */
  readonly tasaAnual: string | number;
}

export interface DetalleInteresAnio {
  readonly anio: number;
  readonly saldoBase: string;
  readonly interes: string;
  readonly saldoFinal: string;
}

export interface ResultadoIntereses {
  readonly saldoFinal: string;
  readonly interesesTotales: string;
  readonly detalle: readonly DetalleInteresAnio[];
}

/**
 * Intereses sobre prestaciones capitalizados anualmente (art. 143; docs/04 §2.3). Cada año: se
 * abona el depósito, se calcula el interés sobre el saldo resultante a la tasa promedio BCV y se
 * capitaliza (suma al saldo). Las tasas llegan como parámetro (no se conoce la tabla aquí).
 */
export function interesesPrestaciones(
  movimientos: readonly MovimientoInteres[],
  opciones: { readonly saldoInicial?: string | number; readonly decimales?: number } = {},
): ResultadoIntereses {
  const dec = opciones.decimales ?? 2;
  let saldo = aDecimalNoNeg(opciones.saldoInicial, 'saldoInicial', true);
  let interesesTotales = new Decimal(0);
  const detalle: DetalleInteresAnio[] = [];

  for (const m of movimientos) {
    const deposito = aDecimalNoNeg(m.deposito, 'deposito');
    const tasa = aDecimalNoNeg(m.tasaAnual, 'tasaAnual');
    const saldoBase = saldo.plus(deposito);
    const interes = saldoBase.times(tasa).div(100);
    saldo = saldoBase.plus(interes);
    interesesTotales = interesesTotales.plus(interes);
    detalle.push({
      anio: m.anio,
      saldoBase: redondear(saldoBase, dec).toFixed(dec),
      interes: redondear(interes, dec).toFixed(dec),
      saldoFinal: redondear(saldo, dec).toFixed(dec),
    });
  }

  return {
    saldoFinal: redondear(saldo, dec).toFixed(dec),
    interesesTotales: redondear(interesesTotales, dec).toFixed(dec),
    detalle,
  };
}
