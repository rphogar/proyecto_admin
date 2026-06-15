/**
 * Error del motor de fórmulas seguras de conceptos de nómina. Se lanza ante cualquier
 * token, identificador o función fuera de la lista blanca, sintaxis inválida o uso
 * indebido de operadores. La UI usa {@link validarFormula} para evitar guardar una
 * fórmula que dispararía este error en tiempo de cálculo.
 */
export class FormulaInvalidaError extends Error {
  /** Posición (índice de carácter) en la expresión donde se detectó el problema, si aplica. */
  readonly posicion: number | undefined;

  constructor(mensaje: string, posicion?: number) {
    super(mensaje);
    this.name = 'FormulaInvalidaError';
    this.posicion = posicion;
  }
}
