import { DateTime } from 'luxon';

/**
 * Utilidades de fecha en la zona de negocio `America/Caracas` (regla 15 de CLAUDE.md).
 *
 * Los timestamps se ALMACENAN en UTC, pero la "fecha fiscal" de un documento y el corte
 * de los períodos fiscales se calculan en hora de Caracas. Caracas es UTC−4 fijo (sin DST),
 * pero usamos la zona IANA para quedar robustos si la regla cambiara. Nunca se usa la hora
 * local del runtime (el servidor puede estar en otra zona).
 */
export const ZONA_CARACAS = 'America/Caracas';

/** Instante UTC aceptado: Date, epoch en ms, o string ISO 8601. */
export type InstanteUtc = Date | number | string;

function aDateTimeUtc(ts: InstanteUtc): DateTime {
  let dt: DateTime;
  if (ts instanceof Date) {
    dt = DateTime.fromJSDate(ts, { zone: 'utc' });
  } else if (typeof ts === 'number') {
    dt = DateTime.fromMillis(ts, { zone: 'utc' });
  } else {
    dt = DateTime.fromISO(ts, { zone: 'utc' });
  }
  if (!dt.isValid) {
    throw new Error(`Instante UTC inválido: ${String(ts)}`);
  }
  return dt;
}

/**
 * Fecha fiscal (civil en Caracas) de un instante UTC, como `'YYYY-MM-DD'`.
 * Es la fecha del documento a efectos fiscales: la de Caracas, no la de UTC.
 */
export function fechaFiscal(tsUtc: InstanteUtc): string {
  const local = aDateTimeUtc(tsUtc).setZone(ZONA_CARACAS);
  const iso = local.toISODate();
  if (iso === null) {
    throw new Error(`No se pudo derivar la fecha fiscal de: ${String(tsUtc)}`);
  }
  return iso;
}

/** Período fiscal (mes calendario en Caracas) al que pertenece un instante UTC. */
export function periodoFiscal(tsUtc: InstanteUtc): { anio: number; mes: number } {
  const local = aDateTimeUtc(tsUtc).setZone(ZONA_CARACAS);
  return { anio: local.year, mes: local.month };
}

/**
 * Límites UTC de un período mensual fiscal, como intervalo **semiabierto** `[inicioUtc, finUtc)`:
 * `inicioUtc` = 00:00 (Caracas) del día 1; `finUtc` = 00:00 (Caracas) del día 1 del mes siguiente.
 * Los consumidores filtran con `ts >= inicioUtc && ts < finUtc` (evita el bug del último ms).
 */
export function limitesPeriodoMensual(
  anio: number,
  mes: number,
): { inicioUtc: Date; finUtc: Date } {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`Mes inválido: ${mes}`);
  }
  if (!Number.isInteger(anio)) {
    throw new Error(`Año inválido: ${anio}`);
  }
  const inicio = DateTime.fromObject(
    { year: anio, month: mes, day: 1 },
    { zone: ZONA_CARACAS },
  ).startOf('day');
  const fin = inicio.plus({ months: 1 });
  return { inicioUtc: inicio.toUTC().toJSDate(), finUtc: fin.toUTC().toJSDate() };
}

/**
 * Convierte una fecha/hora civil de Caracas (ISO, p.ej. `'2026-01-15'` o
 * `'2026-01-15T08:00'`) al instante UTC correspondiente.
 */
export function caracasAUtc(fechaLocalISO: string): Date {
  const dt = DateTime.fromISO(fechaLocalISO, { zone: ZONA_CARACAS });
  if (!dt.isValid) {
    throw new Error(`Fecha local de Caracas inválida: ${fechaLocalISO}`);
  }
  return dt.toUTC().toJSDate();
}
