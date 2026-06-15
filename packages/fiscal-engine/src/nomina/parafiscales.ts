import { Decimal } from '@contave/shared';
import { aDecimalNoNeg, DIAS_MES, redondear } from './comun';

/**
 * Cálculo de PARAFISCALES (docs/04 §3): retenciones al trabajador y aportes del patrono de IVSS,
 * RPE, FAOV e INCES. Función PURA. Todas las alícuotas, topes y la clase de riesgo llegan como
 * PARÁMETROS resueltos de `fiscal_params` (regla 17 de CLAUDE.md: nunca hardcodeados).
 *
 * Modelo de cotización semanal IVSS/RPE (caso 49): el IVSS/RPE cotiza por semanas (lunes). La base
 * semanal = salario diario TOPADO × 7; la cotización del mes = base semanal × semanas cotizables
 * (4 ó 5 lunes). Por eso un mes con 5 lunes cotiza más. El tope se aplica en salarios mínimos
 * (IVSS 5, RPE 10).  FAOV cotiza mensual sobre el salario INTEGRAL sin tope. INCES: 2% patrono
 * sobre la nómina (empresas de 5+ trabajadores) y 0,5% trabajador sobre utilidades pagadas.
 *
 * TODO-TRIBUTARISTA: confirmar (a) la base de cotización exacta del IVSS (semanal vs. mensual y el
 * tratamiento del tope), (b) la base de cotización para salario en divisas, y (c) la base patronal
 * de INCES (nómina total vs. conceptos específicos).
 */

export type RiesgoIvss = 'minimo' | 'medio' | 'maximo';

export interface AlicuotasParafiscales {
  readonly ivss: {
    readonly trabajador: string | number; // % (p.ej. 4)
    readonly patronoPorRiesgo: Readonly<Record<RiesgoIvss, string | number>>; // 9/10/11
    readonly topeSalariosMinimos: string | number; // 5
  };
  readonly rpe: {
    readonly trabajador: string | number; // 0.5
    readonly patrono: string | number; // 2
    readonly topeSalariosMinimos: string | number; // 10
  };
  readonly faov: {
    readonly trabajador: string | number; // 1
    readonly patrono: string | number; // 2
  };
  readonly inces: {
    readonly trabajador: string | number; // 0.5 sobre utilidades
    readonly patrono: string | number; // 2 sobre nómina
  };
}

export interface ParafiscalesInput {
  readonly salarioNormalMensual: string | number;
  readonly salarioIntegralMensual: string | number;
  readonly salarioMinimoMensual: string | number;
  readonly riesgoIvss: RiesgoIvss;
  /** Semanas cotizables (lunes del mes); ver {@link semanasCotizablesDelMes}. */
  readonly semanasCotizables: number;
  /** Utilidades pagadas en el período (base del 0,5% del trabajador para INCES). */
  readonly utilidadesPagadas?: string | number;
  /** Empresa con 5+ trabajadores: aplica el 2% patronal de INCES sobre la nómina. */
  readonly cincoOMasTrabajadores?: boolean;
  readonly alicuotas: AlicuotasParafiscales;
  readonly decimales?: number;
}

export interface DetalleRegimen {
  readonly base: string;
  readonly trabajador: string;
  readonly patrono: string;
}

export interface ResultadoParafiscales {
  readonly ivss: DetalleRegimen;
  readonly rpe: DetalleRegimen;
  readonly faov: DetalleRegimen;
  readonly inces: DetalleRegimen;
  readonly totalTrabajador: string;
  readonly totalPatrono: string;
}

function pct(base: Decimal, tasa: string | number): Decimal {
  return base.times(aDecimalNoNeg(tasa, 'alícuota')).div(100);
}

/** Cotización mensual semanal topada: min(normal, tope)/30 × 7 × semanas. */
function baseSemanalTopada(normalMensual: Decimal, tope: Decimal, semanas: number): Decimal {
  const baseMensualTopada = Decimal.min(normalMensual, tope);
  return baseMensualTopada.div(DIAS_MES).times(7).times(semanas);
}

export function calcularParafiscales(input: ParafiscalesInput): ResultadoParafiscales {
  const dec = input.decimales ?? 2;
  const normal = aDecimalNoNeg(input.salarioNormalMensual, 'salarioNormalMensual');
  const integral = aDecimalNoNeg(input.salarioIntegralMensual, 'salarioIntegralMensual');
  const salarioMinimo = aDecimalNoNeg(input.salarioMinimoMensual, 'salarioMinimoMensual');
  const utilidades = aDecimalNoNeg(input.utilidadesPagadas, 'utilidadesPagadas', true);
  const semanas = input.semanasCotizables;
  if (!Number.isInteger(semanas) || semanas < 0) {
    throw new Error(`calcularParafiscales: semanasCotizables inválidas: ${String(semanas)}`);
  }
  const a = input.alicuotas;

  // IVSS — base semanal topada a 5 salarios mínimos.
  const topeIvss = salarioMinimo.times(aDecimalNoNeg(a.ivss.topeSalariosMinimos, 'tope IVSS'));
  const baseIvss = baseSemanalTopada(normal, topeIvss, semanas);
  const patronoIvssTasa = a.ivss.patronoPorRiesgo[input.riesgoIvss];
  if (patronoIvssTasa === undefined) {
    throw new Error(`calcularParafiscales: riesgoIvss desconocido '${input.riesgoIvss}'`);
  }
  const ivss: DetalleRegimen = {
    base: redondear(baseIvss, dec).toFixed(dec),
    trabajador: redondear(pct(baseIvss, a.ivss.trabajador), dec).toFixed(dec),
    patrono: redondear(pct(baseIvss, patronoIvssTasa), dec).toFixed(dec),
  };

  // RPE — base semanal topada a 10 salarios mínimos.
  const topeRpe = salarioMinimo.times(aDecimalNoNeg(a.rpe.topeSalariosMinimos, 'tope RPE'));
  const baseRpe = baseSemanalTopada(normal, topeRpe, semanas);
  const rpe: DetalleRegimen = {
    base: redondear(baseRpe, dec).toFixed(dec),
    trabajador: redondear(pct(baseRpe, a.rpe.trabajador), dec).toFixed(dec),
    patrono: redondear(pct(baseRpe, a.rpe.patrono), dec).toFixed(dec),
  };

  // FAOV — mensual sobre el salario integral, sin tope.
  const faov: DetalleRegimen = {
    base: redondear(integral, dec).toFixed(dec),
    trabajador: redondear(pct(integral, a.faov.trabajador), dec).toFixed(dec),
    patrono: redondear(pct(integral, a.faov.patrono), dec).toFixed(dec),
  };

  // INCES — 0,5% trabajador sobre utilidades pagadas; 2% patrono sobre nómina (5+ trabajadores).
  const incesPatronoBase = input.cincoOMasTrabajadores ? normal : new Decimal(0);
  const inces: DetalleRegimen = {
    base: redondear(incesPatronoBase, dec).toFixed(dec),
    trabajador: redondear(pct(utilidades, a.inces.trabajador), dec).toFixed(dec),
    patrono: redondear(pct(incesPatronoBase, a.inces.patrono), dec).toFixed(dec),
  };

  const totalTrabajador = new Decimal(ivss.trabajador)
    .plus(rpe.trabajador)
    .plus(faov.trabajador)
    .plus(inces.trabajador);
  const totalPatrono = new Decimal(ivss.patrono)
    .plus(rpe.patrono)
    .plus(faov.patrono)
    .plus(inces.patrono);

  return {
    ivss,
    rpe,
    faov,
    inces,
    totalTrabajador: redondear(totalTrabajador, dec).toFixed(dec),
    totalPatrono: redondear(totalPatrono, dec).toFixed(dec),
  };
}
