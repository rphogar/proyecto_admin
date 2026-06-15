import { FormulaInvalidaError } from './errores';

/**
 * Analizador léxico del DSL de fórmulas de nómina. Convierte la expresión en una lista de
 * tokens. NO usa `eval`/`RegExp` dinámico: recorre carácter a carácter con una lista blanca
 * estricta de símbolos. Cualquier carácter desconocido → {@link FormulaInvalidaError}.
 */

export type TipoToken =
  | 'NUMERO'
  | 'IDENT'
  | 'OP' // + - * /
  | 'COMPARA' // == != > >= < <=
  | 'PARENI'
  | 'PAREND'
  | 'COMA';

export interface Token {
  readonly tipo: TipoToken;
  readonly valor: string;
  readonly pos: number;
}

const ESPACIOS = new Set([' ', '\t', '\n', '\r']);
const OPERADORES = new Set(['+', '-', '*', '/']);

function esDigito(c: string): boolean {
  return c >= '0' && c <= '9';
}

function esInicioIdent(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
}

function esIdent(c: string): boolean {
  return esInicioIdent(c) || esDigito(c);
}

/** Tokeniza `expr`. Lanza {@link FormulaInvalidaError} ante un carácter o símbolo no permitido. */
export function tokenizar(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;

  while (i < n) {
    const c = expr.charAt(i);

    if (ESPACIOS.has(c)) {
      i += 1;
      continue;
    }

    if (c === '(') {
      tokens.push({ tipo: 'PARENI', valor: '(', pos: i });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ tipo: 'PAREND', valor: ')', pos: i });
      i += 1;
      continue;
    }
    if (c === ',') {
      tokens.push({ tipo: 'COMA', valor: ',', pos: i });
      i += 1;
      continue;
    }

    if (OPERADORES.has(c)) {
      tokens.push({ tipo: 'OP', valor: c, pos: i });
      i += 1;
      continue;
    }

    // Comparadores: ==, !=, >=, <=, >, <
    if (c === '=' || c === '!' || c === '>' || c === '<') {
      const dos = expr.slice(i, i + 2);
      if (dos === '==' || dos === '!=' || dos === '>=' || dos === '<=') {
        tokens.push({ tipo: 'COMPARA', valor: dos, pos: i });
        i += 2;
        continue;
      }
      if (c === '>' || c === '<') {
        tokens.push({ tipo: 'COMPARA', valor: c, pos: i });
        i += 1;
        continue;
      }
      // '=' suelto o '!' suelto no son válidos (no hay asignación ni negación lógica).
      throw new FormulaInvalidaError(`Operador inválido '${c}'. Use ==, !=, >, >=, <, <=.`, i);
    }

    if (esDigito(c) || (c === '.' && esDigito(expr.charAt(i + 1)))) {
      let j = i;
      let puntos = 0;
      while (j < n && (esDigito(expr.charAt(j)) || expr.charAt(j) === '.')) {
        if (expr.charAt(j) === '.') puntos += 1;
        j += 1;
      }
      if (puntos > 1) {
        throw new FormulaInvalidaError(`Número inválido '${expr.slice(i, j)}'.`, i);
      }
      tokens.push({ tipo: 'NUMERO', valor: expr.slice(i, j), pos: i });
      i = j;
      continue;
    }

    if (esInicioIdent(c)) {
      let j = i;
      while (j < n && esIdent(expr.charAt(j))) j += 1;
      tokens.push({ tipo: 'IDENT', valor: expr.slice(i, j), pos: i });
      i = j;
      continue;
    }

    throw new FormulaInvalidaError(`Carácter no permitido '${c}'.`, i);
  }

  return tokens;
}
