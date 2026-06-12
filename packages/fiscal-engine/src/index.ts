// @contave/fiscal-engine — motor fiscal puro (sin IO), 100% testeable.
// Los cálculos de IVA multi-alícuota, prorrata, IGTF, retenciones IVA/ISLR y nómina son funciones
// puras deterministas con golden tests; se implementan en P7+. La carpeta golden/ se crea junto
// con el primer golden test numérico.
export const FISCAL_ENGINE_PACKAGE = '@contave/fiscal-engine';

// P6 — Validador PRE-EMISIÓN de requisitos de facturación (00071/00102/00121): función pura que
// devuelve la lista de incumplimientos antes de emitir un documento fiscal.
export { validarRequisitosFactura } from './facturacion/validar-requisitos';
export type {
  TipoDocumento,
  MedioEmision,
  AlicuotaCodigo,
  Norma,
  Incumplimiento,
  EmisorAValidar,
  AdquirenteAValidar,
  LineaAValidar,
  ImpuestoAValidar,
  DocumentoAfectado,
  DocumentoAEmitir,
} from './facturacion/validar-requisitos';
