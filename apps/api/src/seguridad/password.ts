import { hash, type Options, verify } from '@node-rs/argon2';

/**
 * Hashing de contraseñas con **Argon2id** (docs/05 §6, regla 14) — el KDF resistente a GPU/ASIC
 * recomendado para credenciales. Se usa `@node-rs/argon2` (binarios precompilados, sin node-gyp).
 *
 * Argon2id ya incorpora la sal aleatoria dentro del hash codificado (formato PHC
 * `$argon2id$v=19$m=...,t=...,p=...$<sal>$<hash>`), así que `password_hash` guarda todo lo
 * necesario para verificar; no hay columna de sal aparte. La verificación es de tiempo
 * (cuasi)constante por diseño del algoritmo.
 */

/**
 * Parámetros de coste. Alineados con las recomendaciones OWASP para Argon2id (memoria ~19 MiB,
 * 2 iteraciones, paralelismo 1) — equilibrio entre resistencia y latencia de login aceptable.
 */
const OPCIONES: Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Calcula el hash Argon2id (con sal aleatoria embebida) de una contraseña en claro. */
export async function hashPassword(plano: string): Promise<string> {
  return hash(plano, OPCIONES);
}

/**
 * Verifica una contraseña contra su hash almacenado. Devuelve `false` (sin lanzar) ante un hash
 * con formato inválido o corrupto, para que el llamador trate el fallo como credenciales erróneas.
 */
export async function verifyPassword(hashAlmacenado: string, plano: string): Promise<boolean> {
  try {
    return await verify(hashAlmacenado, plano);
  } catch {
    return false;
  }
}
