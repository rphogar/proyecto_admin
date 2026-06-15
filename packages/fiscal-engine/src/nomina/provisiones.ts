import { Decimal } from '@contave/shared';
import { aDecimalNoNeg, redondear } from './comun';

/**
 * Provisiones mensuales de pasivos laborales (docs/04 §2; flujo §5). Función pura que devuelve la
 * porción a provisionar en el mes (1/12 de los conceptos anuales + la garantía de prestaciones del
 * mes + los intereses del mes). El asiento (gasto 6.1 contra pasivos 2.4.0x) lo arma el servicio.
 *
 *  - Utilidades:      salario_diario × dias_utilidades / 12
 *  - Vacaciones:      salario_diario × dias_vacaciones / 12
 *  - Bono vacacional: salario_diario × dias_bono_vacacional / 12
 *  - Prestaciones (garantía art. 142): 15 días integral/trimestre = 5 días integral/mes
 *  - Intereses:       saldo de garantía × tasa anual / 12
 *
 * Para un aumento retroactivo (caso 51) el servicio recalcula el TRIMESTRE vigente con estos
 * valores; nunca toca períodos cerrados (regla 9). Aquí solo se calcula el mes.
 */

export interface ProvisionesMesInput {
  readonly salarioDiario: string | number;
  readonly salarioDiarioIntegral: string | number;
  readonly diasUtilidades: number;
  readonly diasVacaciones: number;
  readonly diasBonoVacacional: number;
  /** Saldo acumulado de garantía para el cálculo de intereses del mes. */
  readonly saldoGarantia?: string | number;
  /** Tasa anual promedio BCV en % para los intereses del mes. */
  readonly tasaInteresAnual?: string | number;
  /** Días de garantía a provisionar en el mes (defecto 5 = 15 días/trimestre). */
  readonly diasGarantiaMes?: number;
  readonly decimales?: number;
}

export interface ResultadoProvisionesMes {
  readonly utilidades: string;
  readonly vacaciones: string;
  readonly bonoVacacional: string;
  readonly prestaciones: string;
  readonly intereses: string;
  readonly total: string;
}

export function calcularProvisionesMes(input: ProvisionesMesInput): ResultadoProvisionesMes {
  const dec = input.decimales ?? 2;
  const salarioDiario = aDecimalNoNeg(input.salarioDiario, 'salarioDiario');
  const integralDiario = aDecimalNoNeg(input.salarioDiarioIntegral, 'salarioDiarioIntegral');
  const saldoGarantia = aDecimalNoNeg(input.saldoGarantia, 'saldoGarantia', true);
  const tasaAnual = aDecimalNoNeg(input.tasaInteresAnual, 'tasaInteresAnual', true);
  const diasGarantiaMes = new Decimal(input.diasGarantiaMes ?? 5);

  const utilidades = salarioDiario.times(input.diasUtilidades).div(12);
  const vacaciones = salarioDiario.times(input.diasVacaciones).div(12);
  const bonoVacacional = salarioDiario.times(input.diasBonoVacacional).div(12);
  const prestaciones = integralDiario.times(diasGarantiaMes);
  const intereses = saldoGarantia.times(tasaAnual).div(100).div(12);

  const utilidadesR = redondear(utilidades, dec);
  const vacacionesR = redondear(vacaciones, dec);
  const bonoR = redondear(bonoVacacional, dec);
  const prestacionesR = redondear(prestaciones, dec);
  const interesesR = redondear(intereses, dec);
  const total = utilidadesR.plus(vacacionesR).plus(bonoR).plus(prestacionesR).plus(interesesR);

  return {
    utilidades: utilidadesR.toFixed(dec),
    vacaciones: vacacionesR.toFixed(dec),
    bonoVacacional: bonoR.toFixed(dec),
    prestaciones: prestacionesR.toFixed(dec),
    intereses: interesesR.toFixed(dec),
    total: total.toFixed(dec),
  };
}
