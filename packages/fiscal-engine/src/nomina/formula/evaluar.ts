import { Decimal, REDONDEO_FISCAL } from '@contave/shared';
import { FormulaInvalidaError } from './errores';
import { parsear, type Nodo } from './parsear';

/**
 * Evaluador del DSL de fórmulas seguras de conceptos de nómina (regla 3 de CLAUDE.md: el
 * cálculo es una función pura, determinista y testeable; la UI nunca calcula, solo muestra).
 *
 * SEGURIDAD: no hay `eval` ni `Function`. Solo se evalúan nodos del AST con identificadores y
 * funciones de una LISTA BLANCA. Toda la aritmética es sobre `Decimal` (regla 1: nada de float).
 * Una variable no presente en el `scope` o una función desconocida lanza
 * {@link FormulaInvalidaError}. La división por cero también.
 */

/** Valor de una variable del scope: monto (`Decimal`/string/number) o bandera booleana. */
export type ValorScope = Decimal | string | number | boolean;

export type ScopeFormula = Readonly<Record<string, ValorScope>>;

type Valor = Decimal | boolean;

/** Funciones permitidas en las fórmulas. Aridad fija salvo min/max (≥1). */
const FUNCIONES = new Set(['min', 'max', 'round', 'abs', 'if']);

function aDecimal(v: Valor, contexto: string): Decimal {
  if (typeof v === 'boolean') {
    throw new FormulaInvalidaError(`Se esperaba un número pero se obtuvo un booleano en ${contexto}.`);
  }
  return v;
}

function aBooleano(v: Valor, contexto: string): boolean {
  if (typeof v !== 'boolean') {
    throw new FormulaInvalidaError(`Se esperaba una condición booleana en ${contexto}.`);
  }
  return v;
}

function valorScopeADecimal(v: ValorScope, nombre: string): Decimal {
  if (typeof v === 'boolean') {
    throw new FormulaInvalidaError(`La variable '${nombre}' es booleana y se usó como número.`);
  }
  try {
    const d = new Decimal(v);
    if (!d.isFinite()) {
      throw new Error('no finito');
    }
    return d;
  } catch {
    throw new FormulaInvalidaError(`La variable '${nombre}' no es un número válido: ${String(v)}.`);
  }
}

function evaluarNodo(nodo: Nodo, scope: ScopeFormula): Valor {
  switch (nodo.tipo) {
    case 'num':
      return new Decimal(nodo.valor);

    case 'var': {
      const v = scope[nodo.nombre];
      if (v === undefined) {
        throw new FormulaInvalidaError(`Variable desconocida '${nodo.nombre}'.`, nodo.pos);
      }
      return typeof v === 'boolean' ? v : valorScopeADecimal(v, nodo.nombre);
    }

    case 'neg':
      return aDecimal(evaluarNodo(nodo.arg, scope), 'negación').negated();

    case 'bin': {
      const izq = aDecimal(evaluarNodo(nodo.izq, scope), `operación '${nodo.op}'`);
      const der = aDecimal(evaluarNodo(nodo.der, scope), `operación '${nodo.op}'`);
      if (nodo.op === '+') return izq.plus(der);
      if (nodo.op === '-') return izq.minus(der);
      if (nodo.op === '*') return izq.times(der);
      if (der.isZero()) {
        throw new FormulaInvalidaError('División por cero en la fórmula.');
      }
      return izq.div(der);
    }

    case 'cmp': {
      const izq = aDecimal(evaluarNodo(nodo.izq, scope), `comparación '${nodo.op}'`);
      const der = aDecimal(evaluarNodo(nodo.der, scope), `comparación '${nodo.op}'`);
      switch (nodo.op) {
        case '==':
          return izq.eq(der);
        case '!=':
          return !izq.eq(der);
        case '>':
          return izq.gt(der);
        case '>=':
          return izq.gte(der);
        case '<':
          return izq.lt(der);
        case '<=':
          return izq.lte(der);
      }
      return false;
    }

    case 'call':
      return evaluarLlamada(nodo, scope);

    default: {
      const _exhaustivo: never = nodo;
      throw new FormulaInvalidaError(`Nodo no soportado: ${JSON.stringify(_exhaustivo)}`);
    }
  }
}

function evaluarLlamada(
  nodo: Extract<Nodo, { tipo: 'call' }>,
  scope: ScopeFormula,
): Valor {
  if (!FUNCIONES.has(nodo.nombre)) {
    throw new FormulaInvalidaError(`Función desconocida '${nodo.nombre}'.`, nodo.pos);
  }

  if (nodo.nombre === 'if') {
    const [condNodo, aNodo, bNodo] = nodo.args;
    if (nodo.args.length !== 3 || condNodo === undefined || aNodo === undefined || bNodo === undefined) {
      throw new FormulaInvalidaError("if(cond, a, b) requiere exactamente 3 argumentos.", nodo.pos);
    }
    const cond = aBooleano(evaluarNodo(condNodo, scope), 'if(...)');
    return evaluarNodo(cond ? aNodo : bNodo, scope);
  }

  const args = nodo.args.map((a) => aDecimal(evaluarNodo(a, scope), `argumento de ${nodo.nombre}(...)`));

  const primero = args[0];
  switch (nodo.nombre) {
    case 'min':
      if (primero === undefined) throw new FormulaInvalidaError('min requiere al menos 1 argumento.', nodo.pos);
      return args.reduce((acc, x) => (x.lt(acc) ? x : acc), primero);
    case 'max':
      if (primero === undefined) throw new FormulaInvalidaError('max requiere al menos 1 argumento.', nodo.pos);
      return args.reduce((acc, x) => (x.gt(acc) ? x : acc), primero);
    case 'abs':
      if (args.length !== 1 || primero === undefined) {
        throw new FormulaInvalidaError('abs requiere 1 argumento.', nodo.pos);
      }
      return primero.abs();
    case 'round': {
      const segundo = args[1];
      if (primero === undefined || args.length > 2) {
        throw new FormulaInvalidaError('round(x) o round(x, decimales).', nodo.pos);
      }
      const decimales = segundo !== undefined ? segundo.toNumber() : 2;
      if (!Number.isInteger(decimales) || decimales < 0 || decimales > 20) {
        throw new FormulaInvalidaError('round: decimales debe ser un entero entre 0 y 20.', nodo.pos);
      }
      return primero.toDecimalPlaces(decimales, REDONDEO_FISCAL);
    }
    default:
      throw new FormulaInvalidaError(`Función desconocida '${nodo.nombre}'.`, nodo.pos);
  }
}

/**
 * Evalúa la fórmula `expr` contra `scope` y devuelve un `Decimal`. Si la fórmula resuelve a un
 * booleano (p.ej. una comparación suelta) se lanza error: una fórmula de concepto debe producir
 * un monto. Para usar lógica condicional emplee `if(cond, monto_a, monto_b)`.
 */
export function evaluarFormula(expr: string, scope: ScopeFormula = {}): Decimal {
  const ast = parsear(expr);
  const resultado = evaluarNodo(ast, scope);
  if (typeof resultado === 'boolean') {
    throw new FormulaInvalidaError(
      'La fórmula debe producir un monto, no un booleano. Use if(cond, a, b).',
    );
  }
  return resultado;
}
