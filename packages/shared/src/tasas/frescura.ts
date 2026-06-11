import type { TasaCambio } from './rate-for';

/**
 * Frescura de la tasa vigente, para el banner de advertencia (caso 57): si el job de captura
 * BCV falla varios días (feriados largos + caída), el sistema sigue operando con la última
 * tasa y avisa, sin recalcular documentos ya emitidos.
 *
 * - `fresca`: la última tasa tiene a lo sumo `maxDias` de rezago (cubre un fin de semana largo).
 * - `rezagada`: entre `maxDias` y `2*maxDias` sin tasa nueva — advertencia visible.
 * - `critica`: más de `2*maxDias`, o no hay ninguna tasa.
 */
export type EstadoFrescura = 'fresca' | 'rezagada' | 'critica';

function aDiaUtc(fecha: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (m === null) {
    throw new Error(`Fecha civil inválida (se esperaba YYYY-MM-DD): ${fecha}`);
  }
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Días de rezago de `ultima` respecto a `hoy` (ambas fechas civiles `'YYYY-MM-DD'`). */
export function diasDeRezago(ultima: TasaCambio | null, hoy: string): number | null {
  if (ultima === null) return null;
  return Math.round((aDiaUtc(hoy) - aDiaUtc(ultima.rateDate)) / 86_400_000);
}

export function estadoFrescura(
  ultima: TasaCambio | null,
  hoy: string,
  maxDias = 3,
): EstadoFrescura {
  const rezago = diasDeRezago(ultima, hoy);
  if (rezago === null || rezago > maxDias * 2) return 'critica';
  if (rezago > maxDias) return 'rezagada';
  return 'fresca';
}
