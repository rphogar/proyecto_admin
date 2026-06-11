import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@contave/shared';

/**
 * Validadores de entrada de los maestros (P5). Mismo estilo que `tasas/dto.ts`: lanzan
 * `BadRequestException` con un mensaje accionable. Mantienen la regla 1 (dinero como Decimal-string,
 * nunca float silencioso) y normalizan strings.
 */

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** String obligatorio no vacío (con recorte y tope de longitud). */
export function requireString(valor: unknown, campo: string, maxLen = 500): string {
  const s = String(valor ?? '').trim();
  if (s.length === 0) {
    throw new BadRequestException(`${campo} es obligatorio`);
  }
  if (s.length > maxLen) {
    throw new BadRequestException(`${campo} excede ${maxLen} caracteres`);
  }
  return s;
}

/** String opcional: devuelve el texto recortado o `null` si viene vacío/ausente. */
export function optionalString(valor: unknown, campo: string, maxLen = 500): string | null {
  if (valor === undefined || valor === null) {
    return null;
  }
  const s = String(valor).trim();
  if (s.length === 0) {
    return null;
  }
  if (s.length > maxLen) {
    throw new BadRequestException(`${campo} excede ${maxLen} caracteres`);
  }
  return s;
}

/** Valor de un conjunto cerrado (enum). Normaliza con `transform` antes de comparar. */
export function requireEnum<T extends string>(
  valor: unknown,
  campo: string,
  permitidos: readonly T[],
  transform: (s: string) => string = (s) => s,
): T {
  const v = transform(String(valor ?? '').trim()) as T;
  if (!permitidos.includes(v)) {
    throw new BadRequestException(`${campo} inválido: "${String(valor)}" (use ${permitidos.join(', ')})`);
  }
  return v;
}

/** UUID obligatorio (formato canónico). */
export function requireUuid(valor: unknown, campo: string): string {
  const s = String(valor ?? '').trim();
  if (!PATRON_UUID.test(s)) {
    throw new BadRequestException(`${campo} debe ser un UUID válido`);
  }
  return s.toLowerCase();
}

/** UUID opcional o `null`. */
export function optionalUuid(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }
  return requireUuid(valor, campo);
}

/**
 * Monto Decimal-string (regla 1). Por defecto exige > 0; `permitirCero` lo relaja a >= 0 (precios
 * promocionales). Devuelve la forma canónica `toFixed()` sin perder precisión.
 */
export function requireDecimal(valor: unknown, campo: string, permitirCero = false): string {
  const s = String(valor ?? '').trim();
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    throw new BadRequestException(`${campo} inválido: "${String(valor)}"`);
  }
  if (!d.isFinite() || (permitirCero ? d.lt(0) : d.lte(0))) {
    const cota = permitirCero ? 'no negativo' : 'positivo';
    throw new BadRequestException(`${campo} debe ser un número ${cota}: "${String(valor)}"`);
  }
  return d.toFixed();
}

/** Monto Decimal opcional (>= 0) o `null`. */
export function optionalDecimal(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }
  return requireDecimal(valor, campo, true);
}

/** Entero >= `min` (opcional con default). */
export function optionalInt(valor: unknown, campo: string, def: number, min = 0): number {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return def;
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min) {
    throw new BadRequestException(`${campo} debe ser un entero >= ${min}`);
  }
  return n;
}

/** Booleano opcional con default (acepta true/false y "true"/"false"). */
export function optionalBoolean(valor: unknown, def: boolean): boolean {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return def;
  }
  if (typeof valor === 'boolean') {
    return valor;
  }
  const s = String(valor).trim().toLowerCase();
  if (s === 'true') {
    return true;
  }
  if (s === 'false') {
    return false;
  }
  throw new BadRequestException(`Valor booleano inválido: "${String(valor)}"`);
}

/** Lee un objeto plano del body, garantizando que sea un registro. */
export function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Cuerpo de la petición inválido (se espera un objeto JSON)');
  }
  return body as Record<string, unknown>;
}
