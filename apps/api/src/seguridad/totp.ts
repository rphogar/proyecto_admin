import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) — segundo factor obligatorio para roles sensibles
 * (owner/admin/contador, docs/05 §6). Módulo PURO: las funciones de cálculo son deterministas
 * (el instante se inyecta), de modo que se prueban con los vectores de referencia del RFC 6238.
 *
 * El secreto se almacena por usuario (cifrado at-rest, regla 14) y se provisiona al autenticador
 * como Base32 en un URI `otpauth://`. La verificación admite una ventana de ±N pasos para tolerar
 * desfase de reloj sin abrir la puerta a fuerza bruta (default ±1 = ±30 s).
 */

export interface OpcionesTotp {
  /** Tamaño del paso en segundos (RFC: 30). */
  pasoSegundos: number;
  /** Número de dígitos del código (6 estándar; 8 en los vectores del RFC). */
  digitos: number;
  /** Algoritmo HMAC (RFC 6238 define SHA1/SHA256/SHA512; los autenticadores usan SHA1). */
  algoritmo: 'sha1' | 'sha256' | 'sha512';
  /** Época de referencia T0 en ms (RFC: 0 = epoch Unix). */
  t0Ms: number;
}

export const OPCIONES_TOTP_DEFAULT: OpcionesTotp = {
  pasoSegundos: 30,
  digitos: 6,
  algoritmo: 'sha1',
  t0Ms: 0,
};

function conDefaults(opts?: Partial<OpcionesTotp>): OpcionesTotp {
  return { ...OPCIONES_TOTP_DEFAULT, ...opts };
}

/**
 * HOTP(K, C) (RFC 4226 §5.3): HMAC del contador de 8 bytes big-endian + truncamiento dinámico.
 * Devuelve el código con ceros a la izquierda hasta `digitos`.
 */
export function hotp(secreto: Buffer, contador: number, opts?: Partial<OpcionesTotp>): string {
  const { digitos, algoritmo } = conDefaults(opts);

  // Contador de 8 bytes big-endian (RFC 4226). `BigInt` evita el límite de 2^53 de `number`.
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));

  const hmac = createHmac(algoritmo, secreto).update(buf).digest();

  // Truncamiento dinámico: el nibble bajo del último byte indexa los 4 bytes a extraer.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binario =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const codigo = binario % 10 ** digitos;
  return codigo.toString().padStart(digitos, '0');
}

/** Número de paso (contador HOTP) para un instante dado. */
export function pasoActual(instanteMs: number, opts?: Partial<OpcionesTotp>): number {
  const { pasoSegundos, t0Ms } = conDefaults(opts);
  return Math.floor((instanteMs - t0Ms) / 1000 / pasoSegundos);
}

/** TOTP(K, t) = HOTP(K, paso(t)) (RFC 6238). El instante se inyecta → determinista y testeable. */
export function totp(secreto: Buffer, instanteMs: number, opts?: Partial<OpcionesTotp>): string {
  return hotp(secreto, pasoActual(instanteMs, opts), opts);
}

/**
 * Verifica un código TOTP admitiendo una ventana de ±`ventana` pasos (default ±1) para tolerar
 * desfase de reloj. Compara en tiempo constante (`timingSafeEqual`) para no filtrar información
 * por temporización. Cadenas no numéricas o de longitud distinta se rechazan sin comparar.
 */
export function verificarTotp(
  secreto: Buffer,
  codigo: string,
  instanteMs: number,
  ventana = 1,
  opts?: Partial<OpcionesTotp>,
): boolean {
  const { digitos } = conDefaults(opts);
  const limpio = codigo.trim();
  if (limpio.length !== digitos || !/^\d+$/.test(limpio)) {
    return false;
  }
  const paso = pasoActual(instanteMs, opts);
  const objetivo = Buffer.from(limpio, 'utf8');
  for (let delta = -ventana; delta <= ventana; delta += 1) {
    const candidato = Buffer.from(hotp(secreto, paso + delta, opts), 'utf8');
    if (candidato.length === objetivo.length && timingSafeEqual(candidato, objetivo)) {
      return true;
    }
  }
  return false;
}

// ── Base32 (RFC 4648, sin padding) para provisión al autenticador ────────────────

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica bytes a Base32 mayúsculas sin relleno (formato de los autenticadores). */
export function codificarBase32(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  }
  return salida;
}

/** Decodifica Base32 (tolera minúsculas, espacios y `=` de relleno). */
export function decodificarBase32(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const ch of limpio) {
    const idx = ALFABETO_BASE32.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Carácter Base32 inválido: ${ch}`);
    }
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Genera un secreto aleatorio (20 bytes = 160 bits, recomendado por RFC 4226). */
export function generarSecreto(bytes = 20): { secreto: Buffer; base32: string } {
  const secreto = randomBytes(bytes);
  return { secreto, base32: codificarBase32(secreto) };
}

/**
 * URI `otpauth://totp/...` para el código QR del autenticador. `emisor` y `cuenta` se codifican
 * para URL; los parámetros reflejan las opciones efectivas (algoritmo/dígitos/paso).
 */
export function uriOtpauth(
  base32: string,
  emisor: string,
  cuenta: string,
  opts?: Partial<OpcionesTotp>,
): string {
  const { digitos, pasoSegundos, algoritmo } = conDefaults(opts);
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const params = new URLSearchParams({
    secret: base32,
    issuer: emisor,
    algorithm: algoritmo.toUpperCase(),
    digits: String(digitos),
    period: String(pasoSegundos),
  });
  return `otpauth://totp/${etiqueta}?${params.toString()}`;
}
