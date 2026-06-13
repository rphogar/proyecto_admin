import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Prorrata mensual del crédito fiscal de IVA (Ley del IVA art. 34 y ss.; docs/02 §3.2; caso 13
 * del doc 07). Función PURA y determinista.
 *
 * Cuando el contribuyente realiza a la vez operaciones gravadas y exentas/exoneradas, el crédito
 * fiscal soportado en compras se trata así:
 *  - Crédito **directamente atribuible a ventas gravadas** → 100% deducible.
 *  - Crédito **directamente atribuible a ventas exentas** → 0% deducible (va al costo/gasto).
 *  - Crédito **común** (no atribuible exclusivamente a unas u otras) → deducible solo en la
 *    proporción `ventas gravadas / ventas totales` del período; el resto va al costo/gasto.
 *
 * El porcentaje de prorrata se calcula con las operaciones del período (mensual, regla del doc).
 *
 * TODO-TRIBUTARISTA: confirmar (a) si el período de cómputo del porcentaje es el mes o una ventana
 * móvil de 12 meses con ajuste, y (b) el redondeo normado del porcentaje (entero vs 2 decimales).
 * Aquí el porcentaje se expone redondeado a 2 decimales para reporte, pero el crédito deducible se
 * calcula con la proporción a precisión completa y el resto se obtiene por diferencia, de modo que
 * deducible + costo == crédito común EXACTAMENTE (jamás se pierde ni se inventa un céntimo).
 */

export interface ProrrataInput {
  /** Ventas (operaciones) gravadas del período. */
  readonly ventasGravadas: string | number;
  /** Ventas exentas + exoneradas + no sujetas del período. */
  readonly ventasExentas: string | number;
  /** Crédito fiscal COMÚN del período (no atribuible exclusivamente a gravadas ni a exentas). */
  readonly creditoComun: string | number;
  /** Crédito directamente atribuible a ventas gravadas (100% deducible). Default 0. */
  readonly creditoDirectoGravadas?: string | number;
  /** Crédito directamente atribuible a ventas exentas (0% deducible → costo). Default 0. */
  readonly creditoDirectoExentas?: string | number;
}

export interface OpcionesProrrata {
  readonly decimales?: number;
}

export interface ResultadoProrrata {
  /** Porcentaje deducible (gravadas/totales) en %, redondeado a 2 decimales, para reporte. */
  readonly porcentajeDeducible: string;
  /** Parte deducible del crédito común. */
  readonly creditoComunDeducible: string;
  /** Parte no deducible del crédito común (va al costo/gasto). */
  readonly creditoComunAlCosto: string;
  /** Crédito fiscal deducible TOTAL del período = directo gravadas + común deducible. */
  readonly creditoDeducible: string;
  /** Crédito que va al costo/gasto TOTAL = directo exentas + común al costo. */
  readonly creditoAlCosto: string;
}

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (campo.startsWith('credito')) return new Decimal(0);
    throw new Error(`calcularProrrata: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularProrrata: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularProrrata: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

/**
 * Calcula la prorrata mensual del crédito fiscal.
 *
 * Caso límite: si no hay ventas en el período (gravadas+exentas == 0) no hay base para prorratear;
 * por prudencia el crédito común se difiere al costo (deducible 0%) y se marca porcentaje 0. Si
 * sólo hay ventas gravadas, el porcentaje es 100% y todo el crédito común es deducible.
 */
export function calcularProrrata(
  input: ProrrataInput,
  opciones: OpcionesProrrata = {},
): ResultadoProrrata {
  const decimales = opciones.decimales ?? 2;
  const gravadas = aDecimal(input.ventasGravadas, 'ventasGravadas');
  const exentas = aDecimal(input.ventasExentas, 'ventasExentas');
  const comun = aDecimal(input.creditoComun, 'creditoComun');
  const directoGravadas = aDecimal(input.creditoDirectoGravadas, 'creditoDirectoGravadas');
  const directoExentas = aDecimal(input.creditoDirectoExentas, 'creditoDirectoExentas');

  const totalVentas = gravadas.plus(exentas);
  // Proporción a precisión completa (no la del porcentaje redondeado): evita arrastrar redondeos.
  const proporcion = totalVentas.isZero() ? new Decimal(0) : gravadas.div(totalVentas);

  const comunDeducible = redondear(comun.times(proporcion), decimales);
  // El resto por diferencia: deducible + costo == crédito común exacto.
  const comunAlCosto = redondear(comun, decimales).minus(comunDeducible);

  const deducible = redondear(directoGravadas, decimales).plus(comunDeducible);
  const alCosto = redondear(directoExentas, decimales).plus(comunAlCosto);

  return {
    porcentajeDeducible: proporcion.times(100).toDecimalPlaces(2, REDONDEO_FISCAL).toFixed(2),
    creditoComunDeducible: comunDeducible.toFixed(decimales),
    creditoComunAlCosto: comunAlCosto.toFixed(decimales),
    creditoDeducible: deducible.toFixed(decimales),
    creditoAlCosto: alCosto.toFixed(decimales),
  };
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}
