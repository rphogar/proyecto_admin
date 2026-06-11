/**
 * Contrato de una fuente de tasas BCV (P4, docs/05 §3.3). La captura tiene una fuente PRIMARIA
 * (web del BCV) y una de FALLBACK; ambas implementan esta interfaz, así la orquestación
 * (`CapturaBcvService`) es agnóstica del origen y testeable con fakes (sin red).
 */

/** Moneda extranjera capturada contra VES. */
export type MonedaBcv = 'USD' | 'EUR';

/** Una tasa capturada de una fuente, antes de persistir. `rate` es Decimal-string (regla 1). */
export interface TasaBcvCapturada {
  readonly moneda: MonedaBcv;
  readonly rate: string;
  /** Fecha de publicación declarada por la fuente, si la expone. */
  readonly publishedAt: Date | null;
}

export interface FuenteTasaBcv {
  /** Nombre legible para logs/auditoría (p.ej. 'BCV-web', 'BCV-fallback'). */
  readonly nombre: string;
  /**
   * Obtiene las tasas vigentes para `fecha` (`'YYYY-MM-DD'`, hora de Caracas). Devuelve una
   * lista (USD y/o EUR). Lanza si la fuente es inalcanzable o ilegible (la orquestación decide
   * el fallback). Una lista vacía se trata como "sin tasa" (también dispara fallback).
   */
  obtener(fecha: string): Promise<readonly TasaBcvCapturada[]>;
}

/** Tokens de inyección de las fuentes (Nest no inyecta por interfaz). */
export const FUENTE_PRIMARIA = Symbol('FUENTE_PRIMARIA');
export const FUENTE_FALLBACK = Symbol('FUENTE_FALLBACK');
