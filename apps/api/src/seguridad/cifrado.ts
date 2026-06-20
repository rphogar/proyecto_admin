import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado simétrico de columnas sensibles at-rest (regla 14 de CLAUDE.md): secretos TOTP, y en su
 * momento salarios. AES-256-GCM da confidencialidad + integridad autenticada (el tag detecta
 * manipulación). La clave maestra llega SOLO por variable de entorno (`APP_ENCRYPTION_KEY`,
 * 32 bytes en base64/hex); jamás en el repo.
 *
 * Formato del token: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` — versionado para poder rotar.
 */
const VERSION = 'v1';
const IV_BYTES = 12; // recomendado para GCM

/** Carga y valida la clave maestra de 32 bytes desde el entorno. */
export function claveMaestra(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.APP_ENCRYPTION_KEY;
  if (raw === undefined || raw.length === 0) {
    throw new Error('Falta APP_ENCRYPTION_KEY (clave de cifrado at-rest, 32 bytes).');
  }
  const clave = decodificarClave(raw);
  if (clave.length !== 32) {
    throw new Error(`APP_ENCRYPTION_KEY debe ser de 32 bytes; se recibieron ${clave.length}.`);
  }
  return clave;
}

function decodificarClave(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return Buffer.from(raw, 'base64');
}

/** Cifra texto plano y devuelve el token autodescriptivo. */
export function cifrar(plano: string, clave: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const ct = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Descifra un token producido por `cifrar`; lanza si el formato o el tag de integridad fallan. */
export function descifrar(token: string, clave: Buffer): string {
  const partes = token.split(':');
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new Error('Token cifrado con formato o versión inválida.');
  }
  const [, ivB64, tagB64, ctB64] = partes;
  const decipher = createDecipheriv('aes-256-gcm', clave, Buffer.from(ivB64!, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
  const plano = Buffer.concat([decipher.update(Buffer.from(ctB64!, 'base64')), decipher.final()]);
  return plano.toString('utf8');
}
