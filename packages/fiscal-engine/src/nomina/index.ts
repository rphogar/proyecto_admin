// P15 — Motor de nómina puro (docs/04). Salarios, parafiscales, prestaciones art. 142, recibo y
// provisiones. Funciones deterministas con golden tests (casos 47–50 del doc 07).
export { DECIMALES_NOMINA, DIAS_MES, DIAS_ANIO } from './comun';

export {
  evaluarFormula,
  validarFormula,
  parsear,
  FormulaInvalidaError,
} from './formula';
export type { ScopeFormula, ValorScope, Nodo } from './formula';

export { derivarSalarios, resolverSalarioNormalMensual } from './salarios';
export type { SalariosInput, ResultadoSalarios, ComponenteSalario } from './salarios';

export { semanasCotizablesDelMes } from './semanas-ivss';

export { calcularParafiscales } from './parafiscales';
export type {
  RiesgoIvss,
  AlicuotasParafiscales,
  ParafiscalesInput,
  ResultadoParafiscales,
  DetalleRegimen,
} from './parafiscales';

export { calcularPrestacionesArt142, interesesPrestaciones } from './prestaciones';
export type {
  PrestacionesArt142Input,
  ResultadoPrestacionesArt142,
  MovimientoInteres,
  DetalleInteresAnio,
  ResultadoIntereses,
} from './prestaciones';

export { calcularReciboNomina } from './calcular-recibo';
export type {
  TipoConcepto,
  ConceptoNomina,
  ReciboInput,
  LineaRecibo,
  ResultadoRecibo,
} from './calcular-recibo';

export { calcularProvisionesMes } from './provisiones';
export type { ProvisionesMesInput, ResultadoProvisionesMes } from './provisiones';
