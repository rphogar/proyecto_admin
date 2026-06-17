import { createHash } from 'node:crypto';

/**
 * Encadenamiento criptográfico de la bitácora fiscal (P17, Providencia 121 §6.3 req. 1:
 * integridad, inalterabilidad e inviolabilidad). Función pura y determinista (testeable): cada
 * evento incorpora el hash del evento anterior del mismo tenant, de modo que la secuencia forma una
 * cadena tipo blockchain. Alterar o reordenar un evento rompe el hash de todos los posteriores y se
 * detecta al reverificar (`verificarCadena`). Sin IO.
 */

/** Campos canónicos que entran en la huella de un evento (orden fijo → determinismo). */
export interface InsumoEventoHash {
  /** Hash del evento previo del tenant; null en el génesis de la cadena. */
  prevHash: string | null;
  tenantId: string;
  companyId: string;
  documentId: string | null;
  eventType: string;
  documentNumber: string | null;
  controlNumber: string | null;
  hashDocumento: string | null;
  /** Instante del evento en ISO-8601 UTC (estable). */
  tsUtc: string;
  payload: unknown;
}

/**
 * Canonicaliza un valor ordenando recursivamente las claves de objeto. Necesario porque PostgreSQL
 * `jsonb` NO conserva el orden de inserción de las claves: sin esto, recomputar el hash sobre el
 * payload leído de la base daría distinto al del momento de escritura (falso positivo de corrupción).
 * Los arreglos conservan su orden (es significativo).
 */
function canonicalizar(valor: unknown): unknown {
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  const obj = valor as Record<string, unknown>;
  const ordenado: Record<string, unknown> = {};
  for (const clave of Object.keys(obj).sort()) {
    ordenado[clave] = canonicalizar(obj[clave]);
  }
  return ordenado;
}

/** sha256 hex de la representación canónica del evento (incluye el `prevHash` → cadena). */
export function calcularEventHash(insumo: InsumoEventoHash): string {
  const canonico = JSON.stringify([
    insumo.prevHash,
    insumo.tenantId,
    insumo.companyId,
    insumo.documentId,
    insumo.eventType,
    insumo.documentNumber,
    insumo.controlNumber,
    insumo.hashDocumento,
    insumo.tsUtc,
    canonicalizar(insumo.payload ?? null),
  ]);
  return createHash('sha256').update(canonico).digest('hex');
}

/** Un eslabón ya persistido, para reverificar la integridad de la cadena. */
export interface EslabonCadena extends InsumoEventoHash {
  eventHash: string;
}

export interface ResultadoVerificacion {
  ok: boolean;
  total: number;
  /** Índice (0-based) del primer eslabón corrupto, o null si la cadena es íntegra. */
  rotoEn: number | null;
  motivo: string | null;
}

/**
 * Reverifica una cadena completa de eventos de un tenant, en orden cronológico. Comprueba que (a) el
 * `prevHash` de cada eslabón coincide con el `eventHash` del anterior, y (b) el `eventHash` guardado
 * recomputa exactamente. Devuelve dónde se rompe, si se rompe (inviolabilidad demostrable).
 */
export function verificarCadena(eslabones: readonly EslabonCadena[]): ResultadoVerificacion {
  let esperadoPrev: string | null = null;
  for (let i = 0; i < eslabones.length; i++) {
    const e = eslabones[i] as EslabonCadena;
    if (e.prevHash !== esperadoPrev) {
      return { ok: false, total: eslabones.length, rotoEn: i, motivo: 'prev_hash no enlaza con el evento anterior' };
    }
    const recomputado = calcularEventHash(e);
    if (recomputado !== e.eventHash) {
      return { ok: false, total: eslabones.length, rotoEn: i, motivo: 'event_hash no recomputa (contenido alterado)' };
    }
    esperadoPrev = e.eventHash;
  }
  return { ok: true, total: eslabones.length, rotoEn: null, motivo: null };
}
