import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * JWT firmado con HS256 (HMAC-SHA256) — sesión de auth (P27, docs/05 §6). Módulo PURO y
 * determinista (el instante se inyecta), al estilo de `totp.ts`/`cifrado.ts`: cero dependencias,
 * testeable con vectores propios. NO se rueda criptografía nueva; HS256 es HMAC del header.payload.
 *
 * La clave de firma llega SOLO por variable de entorno (`AUTH_JWT_SECRET`, regla 14), jamás en el
 * repo. Se valida explícitamente el `alg` del header (se rechaza `none` y la confusión de
 * algoritmo) y la expiración (`exp`). El emisor/ámbito (`scope`) los pone quien firma.
 */

/** Algoritmo soportado. Fijo: nunca se confía en el `alg` del token para elegir verificación. */
const ALG = 'HS256';

/** Claims mínimos que maneja el sistema; el payload puede llevar campos adicionales. */
export interface ClaimsJwt {
  /** Sujeto: el `userId` (identidad). */
  sub: string;
  /** Ámbito del token: sesión de acceso o reto de segundo factor. */
  scope: 'access' | '2fa';
  /** Emitido en (epoch segundos). */
  iat: number;
  /** Expira en (epoch segundos). */
  exp: number;
  [extra: string]: unknown;
}

/** Opciones de firma. */
export interface OpcionesFirma {
  /** Tiempo de vida en segundos desde `ahoraMs`. */
  ttlSeg: number;
  /** Instante de referencia en ms (inyectable para tests). */
  ahoraMs?: number;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64');
}

function firmar(headerPayload: string, clave: Buffer): string {
  return base64urlEncode(createHmac('sha256', clave).update(headerPayload).digest());
}

/**
 * Carga y valida la clave de firma desde el entorno. Mismo patrón que `claveMaestra` del cifrado:
 * exige al menos 32 bytes de entropía (HS256 nunca debe firmarse con un secreto corto).
 */
export function claveJwt(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.AUTH_JWT_SECRET;
  if (raw === undefined || raw.length === 0) {
    throw new Error('Falta AUTH_JWT_SECRET (clave de firma del JWT de sesión).');
  }
  const clave = Buffer.from(raw, 'utf8');
  if (clave.length < 32) {
    throw new Error(`AUTH_JWT_SECRET debe tener al menos 32 bytes; tiene ${clave.length}.`);
  }
  return clave;
}

/**
 * Firma un JWT HS256. `payload` aporta `sub`/`scope` y cualquier claim extra; `iat`/`exp` los
 * calcula esta función a partir de `ahoraMs` y `ttlSeg` (no se confía en los del llamador).
 */
export function firmarJwt(
  payload: { sub: string; scope: ClaimsJwt['scope'] } & Record<string, unknown>,
  clave: Buffer,
  opts: OpcionesFirma,
): string {
  const ahoraMs = opts.ahoraMs ?? Date.now();
  const iat = Math.floor(ahoraMs / 1000);
  const claims: ClaimsJwt = { ...payload, iat, exp: iat + opts.ttlSeg };

  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: ALG, typ: 'JWT' }), 'utf8'));
  const body = base64urlEncode(Buffer.from(JSON.stringify(claims), 'utf8'));
  const headerPayload = `${header}.${body}`;
  return `${headerPayload}.${firmar(headerPayload, clave)}`;
}

/**
 * Verifica un JWT HS256 y devuelve sus claims, o `null` si la firma no valida, el `alg` no es el
 * esperado (rechaza `none` y confusión de algoritmo), el formato es inválido o el token expiró.
 * La comparación de la firma es en tiempo constante (`timingSafeEqual`).
 */
export function verificarJwt(
  token: string,
  clave: Buffer,
  ahoraMs: number = Date.now(),
): ClaimsJwt | null {
  const partes = token.split('.');
  if (partes.length !== 3) {
    return null;
  }
  const [header, body, firma] = partes as [string, string, string];

  let cabecera: { alg?: unknown; typ?: unknown };
  try {
    cabecera = JSON.parse(base64urlDecode(header).toString('utf8')) as typeof cabecera;
  } catch {
    return null;
  }
  // Nunca se elige el algoritmo a partir del token: solo se acepta HS256 (mitiga `alg:none`).
  if (cabecera.alg !== ALG) {
    return null;
  }

  const esperada = Buffer.from(firmar(`${header}.${body}`, clave), 'utf8');
  const recibida = Buffer.from(firma, 'utf8');
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
    return null;
  }

  let claims: ClaimsJwt;
  try {
    claims = JSON.parse(base64urlDecode(body).toString('utf8')) as ClaimsJwt;
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || Math.floor(ahoraMs / 1000) >= claims.exp) {
    return null;
  }
  return claims;
}
