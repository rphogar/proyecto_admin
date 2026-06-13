/**
 * Numeración del comprobante de retención (IVA e ISLR) — formato normado `AAAAMMNNNNNNNN`
 * (Providencia SNAT/2015/0049 para IVA; práctica análoga para ISLR; docs/02 §3.3 y §4):
 *  - `AAAA` año y `MM` mes del **período de imputación** (fecha en que se practica la retención).
 *  - `NNNNNNNN` correlativo de 8 dígitos, consecutivo dentro del período, con relleno de ceros.
 *
 * Funciones PURAS: la asignación del correlativo (contador transaccional sin huecos, análogo a la
 * numeración de documentos, docs/05 §4) es responsabilidad de la capa de datos; aquí solo se
 * formatea el número una vez resuelto el consecutivo, y se valida/parsea la cadena.
 */

const LARGO_CORRELATIVO = 8;
const MAX_CORRELATIVO = 99_999_999; // 8 dígitos.
const PATRON = /^(\d{4})(\d{2})(\d{8})$/;

export interface PeriodoComprobante {
  /** Año del período de imputación (p. ej. 2026). */
  readonly anio: number;
  /** Mes del período de imputación (1–12). */
  readonly mes: number;
}

/**
 * Formatea el número de comprobante `AAAAMMNNNNNNNN` a partir del período y el correlativo.
 * @throws si el período es inválido o el correlativo está fuera de rango [1, 99.999.999].
 */
export function formatearNumeroComprobante(periodo: PeriodoComprobante, correlativo: number): string {
  const { anio, mes } = periodo;
  if (!Number.isInteger(anio) || anio < 2000 || anio > 9999) {
    throw new Error(`formatearNumeroComprobante: año inválido: ${anio}`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`formatearNumeroComprobante: mes inválido: ${mes}`);
  }
  if (!Number.isInteger(correlativo) || correlativo < 1 || correlativo > MAX_CORRELATIVO) {
    throw new Error(`formatearNumeroComprobante: correlativo fuera de rango [1, ${MAX_CORRELATIVO}]: ${correlativo}`);
  }
  const aaaa = String(anio).padStart(4, '0');
  const mm = String(mes).padStart(2, '0');
  const nnn = String(correlativo).padStart(LARGO_CORRELATIVO, '0');
  return `${aaaa}${mm}${nnn}`;
}

export interface ComprobanteParseado {
  readonly anio: number;
  readonly mes: number;
  readonly correlativo: number;
}

/** Parsea un número de comprobante `AAAAMMNNNNNNNN`; devuelve null si no cumple el formato. */
export function parsearNumeroComprobante(numero: string): ComprobanteParseado | null {
  const m = PATRON.exec(numero.trim());
  if (m === null) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const correlativo = Number(m[3]);
  if (mes < 1 || mes > 12) return null;
  return { anio, mes, correlativo };
}
