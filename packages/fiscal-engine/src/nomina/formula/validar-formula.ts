import { FormulaInvalidaError } from './errores';
import { parsear, type Nodo } from './parsear';

/**
 * Validación estática de una fórmula de concepto SIN evaluarla, para que la UI avise antes de
 * guardar. Devuelve la lista de problemas (vacía = válida): error de sintaxis, variable fuera de
 * `variablesPermitidas`, función desconocida o aridad incorrecta.
 */

const FUNCIONES_ARIDAD: Readonly<Record<string, (n: number) => boolean>> = {
  min: (n) => n >= 1,
  max: (n) => n >= 1,
  abs: (n) => n === 1,
  round: (n) => n === 1 || n === 2,
  if: (n) => n === 3,
};

function recorrer(nodo: Nodo, permitidas: ReadonlySet<string>, errores: string[]): void {
  switch (nodo.tipo) {
    case 'num':
      return;
    case 'var':
      if (!permitidas.has(nodo.nombre)) {
        errores.push(`Variable no permitida: '${nodo.nombre}'.`);
      }
      return;
    case 'neg':
      recorrer(nodo.arg, permitidas, errores);
      return;
    case 'bin':
    case 'cmp':
      recorrer(nodo.izq, permitidas, errores);
      recorrer(nodo.der, permitidas, errores);
      return;
    case 'call': {
      const aridad = FUNCIONES_ARIDAD[nodo.nombre];
      if (aridad === undefined) {
        errores.push(`Función desconocida: '${nodo.nombre}'.`);
      } else if (!aridad(nodo.args.length)) {
        errores.push(`La función '${nodo.nombre}' recibió ${nodo.args.length} argumento(s) inválidos.`);
      }
      for (const a of nodo.args) recorrer(a, permitidas, errores);
      return;
    }
    default: {
      const _exhaustivo: never = nodo;
      errores.push(`Nodo no soportado: ${JSON.stringify(_exhaustivo)}`);
    }
  }
}

/**
 * Valida `expr` contra el conjunto de `variablesPermitidas`. Devuelve los problemas encontrados;
 * arreglo vacío si la fórmula es válida y solo usa variables/funciones permitidas.
 */
export function validarFormula(expr: string, variablesPermitidas: readonly string[]): string[] {
  let ast: Nodo;
  try {
    ast = parsear(expr);
  } catch (e) {
    if (e instanceof FormulaInvalidaError) return [e.message];
    throw e;
  }
  const errores: string[] = [];
  recorrer(ast, new Set(variablesPermitidas), errores);
  return errores;
}
