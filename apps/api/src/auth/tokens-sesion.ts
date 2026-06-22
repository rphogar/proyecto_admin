import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de refresco ROTATIVO (P27, docs/05 §6). El refresh token es un secreto OPACO de alta
 * entropía; en la DB solo se guarda su **hash SHA-256** (`token_hash`), nunca el valor en claro
 * (al estilo de no guardar contraseñas en claro). Funciones PURAS y deterministas para la parte
 * sin IO: generación del secreto, hashing y la decisión de rotación/reuso.
 *
 * Modelo de rotación: cada refresh emite un par nuevo y marca el anterior como `rotated_to` el
 * sucesor (misma `family_id`). Presentar un token ya rotado o revocado es señal de **robo**: el
 * `AuthService` revoca toda la familia. Aquí vive solo la lógica de clasificación.
 */

/** Bytes de entropía del token opaco (256 bits). */
const BYTES_TOKEN = 32;

export interface TokenOpaco {
  /** Valor en claro que se entrega al cliente (una sola vez). */
  valor: string;
  /** Hash que se persiste y con el que se vuelve a buscar. */
  hash: string;
}

/** Genera un refresh token opaco nuevo y su hash de almacenamiento. */
export function generarRefreshToken(): TokenOpaco {
  const valor = randomBytes(BYTES_TOKEN).toString('base64url');
  return { valor, hash: hashRefreshToken(valor) };
}

/** Hash determinista (SHA-256) de un refresh token para guardarlo/buscarlo sin exponerlo. */
export function hashRefreshToken(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

/** Estado persistido relevante de un refresh token (subconjunto de columnas). */
export interface EstadoRefresh {
  expiresAt: Date;
  revokedAt: Date | null;
  /** Id del token sucesor si ya fue rotado; `null` si aún es el vigente de su familia. */
  rotatedTo: string | null;
}

export type ClasificacionRefresh =
  | { tipo: 'valido' }
  | { tipo: 'expirado' }
  /** Ya rotado o revocado y presentado de nuevo: posible robo → revocar la familia. */
  | { tipo: 'reuso' };

/**
 * Clasifica un refresh presentado contra su estado persistido en `ahora`. Un token vigente es
 * `valido`; uno fuera de plazo es `expirado`; uno ya rotado/revocado que se vuelve a presentar es
 * `reuso` (detección de robo).
 */
export function clasificarRefresh(estado: EstadoRefresh, ahora: Date): ClasificacionRefresh {
  if (estado.revokedAt !== null || estado.rotatedTo !== null) {
    return { tipo: 'reuso' };
  }
  if (estado.expiresAt.getTime() <= ahora.getTime()) {
    return { tipo: 'expirado' };
  }
  return { tipo: 'valido' };
}
