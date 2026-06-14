// @contave/ledger — motor de partida doble triple base (puro, sin IO). Ver CLAUDE.md
// (reglas 4, 7, 8, 9) y docs/03 §1–2 y §4. Cuentas (árbol/naturaleza), asientos en triple base
// con invariante ΣD=ΣC, posting/reversal, períodos con cierre/bloqueo y saldos derivados.

export const LEDGER_PACKAGE = '@contave/ledger';

// --- Cuentas -----------------------------------------------------------------
export {
  type Lado,
  type NaturalezaCuenta,
  ladoOpuesto,
  ladoQueAumenta,
  ladoQueDisminuye,
  naturalezaDeClase,
  saldoNormal,
} from './cuentas/naturaleza';
export {
  claseDeCodigo,
  codigoPadre,
  esAncestro,
  nivelDeCodigo,
  parsearCodigo,
} from './cuentas/codigo';
export {
  atributosDerivados,
  type Cuenta,
  type DefinicionCuenta,
} from './cuentas/cuenta';
export { PlanDeCuentas } from './cuentas/plan-de-cuentas';
export {
  CUENTA_GANANCIA_CAMBIARIA,
  CUENTA_PERDIDA_CAMBIARIA,
  PLAN_DE_CUENTAS_BASE,
  planDeCuentasBase,
} from './cuentas/plan-base';

// --- Asientos ----------------------------------------------------------------
export {
  type EntradaLinea,
  LineaAsiento,
  MONEDA_USD_MGMT,
  MONEDA_VES,
} from './asientos/linea';
export {
  AsientoDesbalanceadoError,
  type BaseDescuadre,
  type Descuadre,
  type ResultadoCuadre,
  verificarCuadre,
} from './asientos/cuadre';
export {
  Asiento,
  type EntradaAsiento,
  type EstadoAsiento,
  type OpcionesAsiento,
} from './asientos/asiento';
export {
  balancearConRedondeo,
  type OpcionesRedondeo,
} from './asientos/redondeo';

// --- Períodos ----------------------------------------------------------------
export {
  type ClavePeriodo,
  type EstadoPeriodo,
  LibroDePeriodos,
  type Periodo,
  PeriodoCerradoError,
  periodoDeFecha,
  referenciaAPeriodoAfectado,
} from './periodos/periodo';

// --- Posting / reverso -------------------------------------------------------
export {
  estaReversado,
  type OpcionesPosteo,
  type OpcionesReverso,
  postear,
  reversar,
} from './posting/posting';

// --- Saldos derivados --------------------------------------------------------
export {
  balanceDeComprobacion,
  type BalanceDeComprobacion,
  calcularMayor,
  type FilaBalanceComprobacion,
  type MovimientoCuenta,
  saldoDeudorUsd,
  saldoDeudorVes,
  saldoEnNaturalezaVes,
} from './saldos/saldos';
export {
  balanceDeComprobacionDesdeMovimientos,
  type BalanceDobleBase,
  type FilaBalanceDobleBase,
} from './saldos/balance-doble-base';

// --- Estados financieros (P13) -----------------------------------------------
export {
  estadoDeResultados,
  type EstadoResultados,
  estadoDeSituacion,
  type EstadoSituacion,
  type NodoEstado,
  rollupPorNivel,
  type SaldoDobleBase,
} from './reportes/estados-financieros';
