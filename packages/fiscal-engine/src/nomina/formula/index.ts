// Motor de fórmulas seguras de conceptos de nómina (DSL/AST puro, sin eval). Ver docs/04 §5.
export { FormulaInvalidaError } from './errores';
export { evaluarFormula } from './evaluar';
export type { ScopeFormula, ValorScope } from './evaluar';
export { validarFormula } from './validar-formula';
export { parsear } from './parsear';
export type { Nodo } from './parsear';
