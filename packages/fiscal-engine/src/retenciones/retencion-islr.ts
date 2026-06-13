import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Motor de RETENCIÓN DE ISLR en la fuente (Decreto 1.808 — Reglamento Parcial en materia de
 * retenciones; docs/02 §4; caso 31 del doc 07). Función PURA y determinista.
 *
 * El agente (típicamente SPE) retiene al pagar ciertos conceptos (honorarios, servicios,
 * arrendamientos, fletes, publicidad, comisiones, intereses…). La **tarifa por concepto** y, para
 * personas naturales residentes, el **sustraendo** llegan como PARÁMETROS resueltos de
 * `fiscal_params` (regla 17 de CLAUDE.md: nunca hardcodeados; la tabla 1.808 vive en parámetros con
 * vigencia). El motor no conoce la tabla: solo aplica la fórmula.
 *
 * Fórmula (PN residente):  retención = base × tarifa% − sustraendo, con **piso en 0**.
 *  - Personas jurídicas: `sustraendo = 0` (no aplica) → retención = base × tarifa%.
 *  - Personas naturales: el sustraendo materializa el mínimo exento; si la base es pequeña,
 *    `base × tarifa% ≤ sustraendo` y la retención da 0 (caso 31: "si la base no supera el umbral,
 *    retención 0"). El umbral implícito es `sustraendo / (tarifa%)`.
 *
 * El sustraendo del Decreto 1.808 para PN residentes se deriva normalmente de
 * `valor_UT × 83,3334 × tarifa%` (83,3334 = 1.000 UT anuales exentas ÷ 12 meses). Esa derivación se
 * hace al resolver el parámetro, fuera de este motor; el caller puede usar {@link sustraendoIslr}
 * como utilidad. TODO-TRIBUTARISTA: confirmar (a) el factor y la base UT vigentes, (b) si el cómputo
 * es por pago o acumulado mensual, y (c) el tratamiento de pagos que mezclan conceptos (caso 32).
 */

export interface RetencionIslrInput {
  /**
   * Base de retención: monto del pago/abono sujeto al concepto (si el pago mezcla conceptos, el
   * caller pasa solo la porción del concepto gravado — caso 32). En la moneda del comprobante.
   */
  readonly base: string | number;
  /** Tarifa del concepto en % (3, 5, 1, 2…), del parámetro de la tabla 1.808. */
  readonly tarifa: string | number;
  /** Sustraendo para PN residentes (monto). 0 o ausente para PJ. */
  readonly sustraendo?: string | number | null;
}

export interface OpcionesRetencionIslr {
  readonly decimales?: number;
}

export interface ResultadoRetencionIslr {
  /** Base de retención, redondeada. */
  readonly base: string;
  /** Tarifa aplicada en %. */
  readonly tarifa: string;
  /** Sustraendo aplicado, redondeado. */
  readonly sustraendo: string;
  /** Retención = max(0, base × tarifa% − sustraendo), redondeada. */
  readonly retencion: string;
  /** `true` si la base no superó el umbral (retención resultó 0 por el sustraendo). */
  readonly bajoUmbral: boolean;
}

function aDecimal(v: string | number | null | undefined, campo: string, opcional = false): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (opcional) return new Decimal(0);
    throw new Error(`calcularRetencionIslr: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularRetencionIslr: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularRetencionIslr: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Calcula la retención de ISLR de un pago por concepto. Aplica el sustraendo y nunca devuelve un
 * monto negativo (el piso en 0 implementa el umbral exento del Decreto 1.808 para PN).
 */
export function calcularRetencionIslr(
  input: RetencionIslrInput,
  opciones: OpcionesRetencionIslr = {},
): ResultadoRetencionIslr {
  const decimales = opciones.decimales ?? 2;
  const base = aDecimal(input.base, 'base');
  const tarifa = aDecimal(input.tarifa, 'tarifa');
  const sustraendo = redondear(aDecimal(input.sustraendo, 'sustraendo', true), decimales);

  const bruto = base.times(tarifa).div(100);
  const neto = bruto.minus(sustraendo);
  const retencion = neto.isNegative() ? new Decimal(0) : redondear(neto, decimales);

  return {
    base: redondear(base, decimales).toFixed(decimales),
    tarifa: tarifa.toFixed(),
    sustraendo: sustraendo.toFixed(decimales),
    retencion: retencion.toFixed(decimales),
    bajoUmbral: retencion.isZero() && bruto.gt(0),
  };
}

/** Factor del sustraendo de PN residentes (1.000 UT anuales exentas ÷ 12). Parametrizable. */
export const FACTOR_SUSTRAENDO_PN = '83.3334';

/**
 * Utilidad para derivar el sustraendo de PN residentes del Decreto 1.808:
 * `sustraendo = valorUT × factor × tarifa%`. El `factor` por defecto es {@link FACTOR_SUSTRAENDO_PN}.
 * TODO-TRIBUTARISTA: validar el factor y la UT base vigentes con un tributarista.
 */
export function sustraendoIslr(
  params: { valorUt: string | number; tarifa: string | number; factor?: string | number },
  opciones: OpcionesRetencionIslr = {},
): string {
  const decimales = opciones.decimales ?? 2;
  const ut = aDecimal(params.valorUt, 'valorUt');
  const tarifa = aDecimal(params.tarifa, 'tarifa');
  const factor = aDecimal(params.factor ?? FACTOR_SUSTRAENDO_PN, 'factor');
  return redondear(ut.times(factor).times(tarifa).div(100), decimales).toFixed(decimales);
}
