import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/** Decimales por defecto para montos de nómina en presentación/almacenamiento de recibo. */
export const DECIMALES_NOMINA = 2;

/** Días/mes y días/año convencionales de la LOTTT para alícuotas y salario diario (art. 121, 122). */
export const DIAS_MES = 30;
export const DIAS_ANIO = 360;

/** Convierte a Decimal validando que sea un número finito ≥ 0. */
export function aDecimalNoNeg(v: string | number | null | undefined, campo: string, opcional = false): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (opcional) return new Decimal(0);
    throw new Error(`nómina: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`nómina: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`nómina: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

/** Redondeo fiscal half-up a `decimales`. */
export function redondear(d: Decimal, decimales: number = DECIMALES_NOMINA): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}
