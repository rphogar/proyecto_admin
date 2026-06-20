import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Determinación de la **base de retención de ISLR cuando un pago mezcla conceptos** (caso 32 del doc
 * 07: factura con servicio + materiales). Función PURA y determinista.
 *
 * Regla (configurable por línea): la retención de ISLR se practica solo sobre la **porción de
 * servicio gravada por el concepto** si las líneas vienen discriminadas (cada línea marca si está
 * sujeta); si NINGUNA línea viene discriminada, se retiene sobre el **total** (criterio conservador).
 * TODO-TRIBUTARISTA: confirmar el tratamiento cuando el proveedor no discrimina servicio vs.
 * materiales (¿base total?, ¿exigir discriminación?) y los conceptos mixtos del Decreto 1.808.
 */

export interface LineaIslr {
  /** Base de la línea (neto sin IVA) en la moneda del documento. */
  readonly base: string | number;
  /** La línea está sujeta a la retención de ISLR del concepto (p. ej. mano de obra/servicio). */
  readonly sujetoIslr?: boolean;
}

export interface ResultadoBaseIslr {
  /** Base de retención resultante (Σ de las líneas que aplican), redondeada. */
  readonly base: string;
  /** true si al menos una línea vino marcada → se respetó la discriminación. */
  readonly huboDiscriminacion: boolean;
  /**
   * true si se retuvo sobre el TOTAL por falta de discriminación (ninguna línea marcada). Señal para
   * mostrar la advertencia TODO-TRIBUTARISTA en la UI.
   */
  readonly usoTotalPorFaltaDeDiscriminacion: boolean;
}

function r2(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Suma la base de ISLR a partir de las líneas del documento.
 * - Si alguna línea trae `sujetoIslr === true`: base = Σ de esas líneas (discriminado, caso 32).
 * - Si ninguna trae el flag: base = Σ de todas las líneas (total) y se marca el uso conservador.
 */
export function baseIslrDeLineas(
  lineas: ReadonlyArray<LineaIslr>,
  opciones: { decimales?: number } = {},
): ResultadoBaseIslr {
  const decimales = opciones.decimales ?? 2;
  const algunaMarcada = lineas.some((l) => l.sujetoIslr === true);

  const suma = lineas
    .filter((l) => (algunaMarcada ? l.sujetoIslr === true : true))
    .reduce((acc, l) => acc.plus(new Decimal(l.base)), new Decimal(0));

  return {
    base: r2(suma, decimales).toFixed(decimales),
    huboDiscriminacion: algunaMarcada,
    usoTotalPorFaltaDeDiscriminacion: !algunaMarcada,
  };
}
