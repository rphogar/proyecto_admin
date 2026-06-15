import { Decimal } from '@contave/shared';
import { aDecimalNoNeg, DIAS_ANIO, DIAS_MES, redondear } from './comun';

/**
 * Derivación de los salarios base de la LOTTT (docs/04 §1). Funciones puras.
 *
 *  - `salario_diario        = salario_normal_mensual / 30`
 *  - `alicuota_utilidades   = (dias_utilidades / 360) × salario_diario`
 *  - `alicuota_bono_vac     = (dias_bono_vacacional / 360) × salario_diario`
 *  - `salario_diario_integral = salario_diario + alicuota_utilidades + alicuota_bono_vac`
 *  - `salario_integral_mensual = salario_diario_integral × 30`
 *
 * El salario INTEGRAL es la base de las prestaciones (art. 142); el NORMAL es la base de IVSS/RPE,
 * vacaciones y retención de ISLR. Las alícuotas materializan la incidencia de utilidades y bono
 * vacacional en el salario integral.
 */

export interface SalariosInput {
  /** Salario normal mensual ya resuelto a una sola moneda (regla 10: la base fiscal es VES). */
  readonly salarioNormalMensual: string | number;
  /** Días de utilidades que paga la empresa (30–120; art. 131). */
  readonly diasUtilidades: number;
  /** Días de bono vacacional (15–30; art. 192). */
  readonly diasBonoVacacional: number;
  /** Decimales de presentación (defecto 8: base intermedia, no documento fiscal). */
  readonly decimales?: number;
}

export interface ResultadoSalarios {
  readonly salarioNormalMensual: string;
  readonly salarioDiario: string;
  readonly alicuotaUtilidadesDia: string;
  readonly alicuotaBonoVacacionalDia: string;
  readonly salarioDiarioIntegral: string;
  readonly salarioIntegralMensual: string;
}

export function derivarSalarios(input: SalariosInput): ResultadoSalarios {
  // Bases intermedias con alta precisión (8) para no arrastrar error de redondeo a prestaciones.
  const dec = input.decimales ?? 8;
  const normal = aDecimalNoNeg(input.salarioNormalMensual, 'salarioNormalMensual');
  const diasUtil = aDecimalNoNeg(input.diasUtilidades, 'diasUtilidades');
  const diasBono = aDecimalNoNeg(input.diasBonoVacacional, 'diasBonoVacacional');

  const salarioDiario = normal.div(DIAS_MES);
  const alicUtil = diasUtil.div(DIAS_ANIO).times(salarioDiario);
  const alicBono = diasBono.div(DIAS_ANIO).times(salarioDiario);
  const integralDiario = salarioDiario.plus(alicUtil).plus(alicBono);
  const integralMensual = integralDiario.times(DIAS_MES);

  return {
    salarioNormalMensual: redondear(normal, dec).toFixed(dec),
    salarioDiario: redondear(salarioDiario, dec).toFixed(dec),
    alicuotaUtilidadesDia: redondear(alicUtil, dec).toFixed(dec),
    alicuotaBonoVacacionalDia: redondear(alicBono, dec).toFixed(dec),
    salarioDiarioIntegral: redondear(integralDiario, dec).toFixed(dec),
    salarioIntegralMensual: redondear(integralMensual, dec).toFixed(dec),
  };
}

/** Componente de un salario pactado en varias monedas (docs/04 §1: salario mixto Bs + divisas). */
export interface ComponenteSalario {
  readonly moneda: string;
  readonly monto: string | number;
  /** Tasa a VES de la fecha de devengo (regla 2: congelada por documento). Obligatoria si moneda ≠ VES. */
  readonly rate?: string | number;
}

/**
 * Resuelve un salario mixto (p.ej. Bs 5.000 + $200) a su equivalente VES sumando cada componente
 * convertido con la tasa de su fecha de devengo (caso 48). La porción en VES usa rate 1.
 * TODO-TRIBUTARISTA: confirmar la base de cotización IVSS para salario en divisas (docs/04 §1).
 */
export function resolverSalarioNormalMensual(
  componentes: readonly ComponenteSalario[],
  opciones: { readonly decimales?: number } = {},
): string {
  const dec = opciones.decimales ?? 8;
  let total = new Decimal(0);
  for (const c of componentes) {
    const monto = aDecimalNoNeg(c.monto, `componente ${c.moneda}`);
    const esVes = c.moneda.trim().toUpperCase() === 'VES';
    if (esVes) {
      total = total.plus(monto);
    } else {
      if (c.rate === undefined || c.rate === null || String(c.rate).trim() === '') {
        throw new Error(`resolverSalarioNormalMensual: falta la tasa para ${c.moneda}`);
      }
      total = total.plus(monto.times(aDecimalNoNeg(c.rate, `tasa ${c.moneda}`)));
    }
  }
  return redondear(total, dec).toFixed(dec);
}
