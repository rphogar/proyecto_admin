/**
 * Backoff exponencial para la cola de remisión al SENIAT (P17, Providencia 121 §6.3 req. 2).
 * Función pura y determinista (testeable): dado el número de reintentos ya realizados, calcula el
 * instante del próximo intento. Crece exponencialmente con un tope, para no martillar el canal del
 * SENIAT cuando esté caído pero sí reintentar "de forma continua" como exige la norma.
 */

/** Base del backoff en segundos (1er reintento ≈ 30s). */
const BASE_SEGUNDOS = 30;
/** Tope del intervalo: nunca esperar más de 1 hora entre intentos. */
const TOPE_SEGUNDOS = 3600;

/** Segundos a esperar antes del intento posterior a `reintentos` fallos (30s, 60s, 120s … ≤ 3600s). */
export function backoffSegundos(reintentos: number): number {
  if (reintentos <= 0) return BASE_SEGUNDOS;
  const escalado = BASE_SEGUNDOS * 2 ** reintentos;
  return Math.min(escalado, TOPE_SEGUNDOS);
}

/** Instante del próximo intento a partir de `desde` tras `reintentos` fallos. */
export function proximoIntento(reintentos: number, desde: Date): Date {
  return new Date(desde.getTime() + backoffSegundos(reintentos) * 1000);
}
