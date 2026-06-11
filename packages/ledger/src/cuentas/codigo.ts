// Estructura del código de cuenta `C.GG.SS.AAA` (clase, grupo, subgrupo, auxiliar),
// de PROFUNDIDAD CONFIGURABLE (docs/03 §2). Cada segmento es numérico; el primero es la clase.

/** Separa un código en sus segmentos (`'1.1.01'` → `['1','1','01']`). */
function segmentos(codigo: string): string[] {
  return codigo.split('.');
}

const SEGMENTO_VALIDO = /^\d+$/;

/**
 * Valida la forma del código y devuelve sus segmentos. Lanza si está vacío, tiene segmentos
 * no numéricos o segmentos vacíos (p.ej. `'1..2'`). No valida que la cuenta exista (eso es
 * responsabilidad de {@link PlanDeCuentas}).
 */
export function parsearCodigo(codigo: string): string[] {
  const limpio = codigo.trim();
  if (limpio === '') {
    throw new Error('Código de cuenta vacío');
  }
  const segs = segmentos(limpio);
  for (const seg of segs) {
    if (!SEGMENTO_VALIDO.test(seg)) {
      throw new Error(`Código de cuenta inválido: "${codigo}" (segmento "${seg}" no es numérico)`);
    }
  }
  return segs;
}

/** Nivel (profundidad) del código = número de segmentos. `'1'`→1, `'1.1'`→2, `'1.1.01'`→3. */
export function nivelDeCodigo(codigo: string): number {
  return parsearCodigo(codigo).length;
}

/** Clase (primer segmento) como número. `'1.1.01'` → 1. */
export function claseDeCodigo(codigo: string): number {
  const [clase] = parsearCodigo(codigo);
  return Number(clase);
}

/**
 * Código del padre directo, o `null` si es de primer nivel (la clase).
 * `'1.1.01'` → `'1.1'`; `'1.1'` → `'1'`; `'1'` → `null`.
 */
export function codigoPadre(codigo: string): string | null {
  const segs = parsearCodigo(codigo);
  if (segs.length <= 1) return null;
  return segs.slice(0, -1).join('.');
}

/** True si `posibleAncestro` es un ancestro propio de `codigo` (o sea, prefijo de segmentos). */
export function esAncestro(posibleAncestro: string, codigo: string): boolean {
  const a = parsearCodigo(posibleAncestro);
  const c = parsearCodigo(codigo);
  if (a.length >= c.length) return false;
  return a.every((seg, i) => seg === c[i]);
}
