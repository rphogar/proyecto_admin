import { DateTime } from 'luxon';

/**
 * Ventanas de fechas comparativas para el dashboard del dueño (docs/06 M0: "Ventas del
 * día/semana/mes vs período anterior"). Trabaja sobre fechas civiles de Caracas (`'YYYY-MM-DD'`,
 * regla 15): la entrada es la fecha fiscal de hoy y la salida son rangos `[desde, hasta]`
 * INCLUSIVOS de fecha fiscal, comparables directamente contra `issue_fecha_fiscal` (un `date`).
 *
 * No hace aritmética de zona horaria (el corte a Caracas ya lo hizo `fechaFiscal`): solo álgebra de
 * calendario sobre la fecha civil, por eso ancla en UTC para evitar cualquier desplazamiento de DST.
 */

/** Rango inclusivo de fechas fiscales `[desde, hasta]` (ambos `'YYYY-MM-DD'`). */
export interface VentanaFechas {
  readonly desde: string;
  readonly hasta: string;
}

/** Una métrica y su período anterior comparable (mismo número de días). */
export interface VentanasComparativas {
  readonly actual: VentanaFechas;
  readonly anterior: VentanaFechas;
}

/** Ventanas día/semana/mes para el widget de ventas, cada una con su período anterior. */
export interface VentanasVentas {
  readonly dia: VentanasComparativas;
  readonly semana: VentanasComparativas;
  readonly mes: VentanasComparativas;
}

function aFecha(iso: string): DateTime {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) {
    throw new Error(`Fecha fiscal inválida: ${iso}`);
  }
  return dt.startOf('day');
}

function iso(dt: DateTime): string {
  const s = dt.toISODate();
  if (s === null) {
    throw new Error('No se pudo serializar la fecha');
  }
  return s;
}

/**
 * Ventanas comparativas para la fecha fiscal `hoyISO`:
 * - **día**: hoy vs ayer.
 * - **semana**: los 7 días que terminan hoy `[hoy−6, hoy]` vs los 7 anteriores `[hoy−13, hoy−7]`.
 * - **mes**: del 1.° del mes a hoy (mes en curso) vs el mismo número de días del mes anterior,
 *   acotado para no rebasar el último día de ese mes (p.ej. 31-mar vs 28-feb).
 */
export function ventanasVentas(hoyISO: string): VentanasVentas {
  const hoy = aFecha(hoyISO);

  const dia: VentanasComparativas = {
    actual: { desde: iso(hoy), hasta: iso(hoy) },
    anterior: { desde: iso(hoy.minus({ days: 1 })), hasta: iso(hoy.minus({ days: 1 })) },
  };

  const semana: VentanasComparativas = {
    actual: { desde: iso(hoy.minus({ days: 6 })), hasta: iso(hoy) },
    anterior: { desde: iso(hoy.minus({ days: 13 })), hasta: iso(hoy.minus({ days: 7 })) },
  };

  const inicioMes = hoy.startOf('month');
  const diasTranscurridos = hoy.day - 1; // 0 el día 1.
  const inicioMesAnterior = inicioMes.minus({ months: 1 });
  // No rebasar el último día del mes anterior (mes en curso más largo que el anterior).
  const finMesAnterior = DateTime.min(
    inicioMesAnterior.plus({ days: diasTranscurridos }),
    inicioMes.minus({ days: 1 }),
  );
  const mes: VentanasComparativas = {
    actual: { desde: iso(inicioMes), hasta: iso(hoy) },
    anterior: { desde: iso(inicioMesAnterior), hasta: iso(finMesAnterior) },
  };

  return { dia, semana, mes };
}
