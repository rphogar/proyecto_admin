import { FormulaInvalidaError } from './errores';
import { tokenizar, type Token } from './tokenizar';

/**
 * Analizador sintáctico (descenso recursivo) del DSL de fórmulas de nómina. Produce un AST
 * inmutable. La gramática (precedencia de menor a mayor):
 *
 *   expr      := comparacion
 *   comparacion := aditivo ( ("=="|"!="|">"|">="|"<"|"<=") aditivo )?
 *   aditivo   := multiplicativo ( ("+"|"-") multiplicativo )*
 *   multiplicativo := unario ( ("*"|"/") unario )*
 *   unario    := "-" unario | primario
 *   primario  := NUMERO | llamada | IDENT | "(" expr ")"
 *   llamada   := IDENT "(" ( expr ("," expr)* )? ")"
 *
 * La comparación no es asociativa (a la izquierda y derecha solo van aritméticos), lo que
 * evita ambigüedades tipo `a > b > c`. Funciones y variables se validan en {@link evaluarFormula}.
 */

export type Nodo =
  | { readonly tipo: 'num'; readonly valor: string }
  | { readonly tipo: 'var'; readonly nombre: string; readonly pos: number }
  | { readonly tipo: 'neg'; readonly arg: Nodo }
  | { readonly tipo: 'bin'; readonly op: '+' | '-' | '*' | '/'; readonly izq: Nodo; readonly der: Nodo }
  | {
      readonly tipo: 'cmp';
      readonly op: '==' | '!=' | '>' | '>=' | '<' | '<=';
      readonly izq: Nodo;
      readonly der: Nodo;
    }
  | { readonly tipo: 'call'; readonly nombre: string; readonly args: readonly Nodo[]; readonly pos: number };

class Parser {
  private pos = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Nodo {
    const nodo = this.comparacion();
    const sobrante = this.tokens[this.pos];
    if (sobrante !== undefined) {
      throw new FormulaInvalidaError(`Token inesperado '${sobrante.valor}'.`, sobrante.pos);
    }
    return nodo;
  }

  private mirar(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consumir(): Token {
    const t = this.tokens[this.pos];
    if (t === undefined) {
      throw new FormulaInvalidaError('Fin inesperado de la expresión.');
    }
    this.pos += 1;
    return t;
  }

  private comparacion(): Nodo {
    const izq = this.aditivo();
    const t = this.mirar();
    if (t !== undefined && t.tipo === 'COMPARA') {
      this.consumir();
      const der = this.aditivo();
      const op = t.valor as '==' | '!=' | '>' | '>=' | '<' | '<=';
      return { tipo: 'cmp', op, izq, der };
    }
    return izq;
  }

  private aditivo(): Nodo {
    let nodo = this.multiplicativo();
    for (;;) {
      const t = this.mirar();
      if (t !== undefined && t.tipo === 'OP' && (t.valor === '+' || t.valor === '-')) {
        this.consumir();
        const der = this.multiplicativo();
        nodo = { tipo: 'bin', op: t.valor, izq: nodo, der };
      } else {
        return nodo;
      }
    }
  }

  private multiplicativo(): Nodo {
    let nodo = this.unario();
    for (;;) {
      const t = this.mirar();
      if (t !== undefined && t.tipo === 'OP' && (t.valor === '*' || t.valor === '/')) {
        this.consumir();
        const der = this.unario();
        nodo = { tipo: 'bin', op: t.valor, izq: nodo, der };
      } else {
        return nodo;
      }
    }
  }

  private unario(): Nodo {
    const t = this.mirar();
    if (t !== undefined && t.tipo === 'OP' && t.valor === '-') {
      this.consumir();
      return { tipo: 'neg', arg: this.unario() };
    }
    if (t !== undefined && t.tipo === 'OP' && t.valor === '+') {
      // '+' unario: no-op.
      this.consumir();
      return this.unario();
    }
    return this.primario();
  }

  private primario(): Nodo {
    const t = this.consumir();

    if (t.tipo === 'NUMERO') {
      return { tipo: 'num', valor: t.valor };
    }

    if (t.tipo === 'PARENI') {
      const nodo = this.comparacion();
      const cierre = this.consumir();
      if (cierre.tipo !== 'PAREND') {
        throw new FormulaInvalidaError("Falta ')'.", cierre.pos);
      }
      return nodo;
    }

    if (t.tipo === 'IDENT') {
      const sig = this.mirar();
      if (sig !== undefined && sig.tipo === 'PARENI') {
        this.consumir(); // '('
        const args: Nodo[] = [];
        if (this.mirar()?.tipo !== 'PAREND') {
          args.push(this.comparacion());
          while (this.mirar()?.tipo === 'COMA') {
            this.consumir();
            args.push(this.comparacion());
          }
        }
        const cierre = this.consumir();
        if (cierre.tipo !== 'PAREND') {
          throw new FormulaInvalidaError("Falta ')' en la llamada a función.", cierre.pos);
        }
        return { tipo: 'call', nombre: t.valor, args, pos: t.pos };
      }
      return { tipo: 'var', nombre: t.valor, pos: t.pos };
    }

    throw new FormulaInvalidaError(`Token inesperado '${t.valor}'.`, t.pos);
  }
}

/** Tokeniza y parsea `expr` a un AST. Lanza {@link FormulaInvalidaError} ante sintaxis inválida. */
export function parsear(expr: string): Nodo {
  if (typeof expr !== 'string' || expr.trim() === '') {
    throw new FormulaInvalidaError('La fórmula está vacía.');
  }
  return new Parser(tokenizar(expr)).parse();
}
