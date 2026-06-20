// @contave/fiscal-engine — motor fiscal puro (sin IO), 100% testeable.
// Los cálculos de IVA multi-alícuota, prorrata, IGTF, retenciones IVA/ISLR y nómina son funciones
// puras deterministas con golden tests (packages/fiscal-engine/golden/). Retenciones y nómina se
// implementan en fases posteriores.
export const FISCAL_ENGINE_PACKAGE = '@contave/fiscal-engine';

// P7 — Motor de IVA multi-alícuota por documento (docs/02 §3; casos 12, 14, 22).
export { calcularIvaDocumento } from './iva/calcular-iva';
// `AlicuotaCodigo` ya se exporta desde ./facturacion/validar-requisitos (mismo dominio); no se
// reexporta aquí para evitar el identificador duplicado.
export type {
  LineaIvaInput,
  OpcionesIva,
  GrupoIva,
  ResultadoIvaDocumento,
} from './iva/calcular-iva';

// P7 — Prorrata mensual del crédito fiscal de IVA (Ley IVA art. 34; caso 13).
export { calcularProrrata } from './iva/prorrata';
export type {
  ProrrataInput,
  OpcionesProrrata,
  ResultadoProrrata,
} from './iva/prorrata';

// P7 — Motor de IGTF causado al pago sobre la porción en divisas (docs/02 §5; casos 4, 34, 35).
export { calcularIgtf, ALICUOTA_IGTF_DEFECTO } from './igtf/calcular-igtf';
export type {
  MetodoPagoIgtf,
  PagoIgtf,
  OpcionesIgtf,
  DetalleIgtf,
  ResultadoIgtf,
} from './igtf/calcular-igtf';

// P9 — Retención de IVA del agente (75/100, Providencia 0049; docs/02 §3.3; casos 26, 27, 29).
export { calcularRetencionIva, porcentajeRetencionIva } from './retenciones/retencion-iva';
export type {
  PorcentajeRetencionIva,
  SeleccionPorcentajeInput,
  RetencionIvaInput,
  OpcionesRetencion,
  ResultadoRetencionIva,
} from './retenciones/retencion-iva';

// P9 — Retención de ISLR por concepto con sustraendo (Decreto 1.808; docs/02 §4; caso 31).
export { calcularRetencionIslr, sustraendoIslr, FACTOR_SUSTRAENDO_PN } from './retenciones/retencion-islr';
export type {
  RetencionIslrInput,
  OpcionesRetencionIslr,
  ResultadoRetencionIslr,
} from './retenciones/retencion-islr';

// P22 — Tabla 1.808 completa y parametrizable (conceptos con tarifa PN/PJ + sustraendo; docs/02 §4;
// caso 31). El catálogo vive en parámetros (regla 17); el resolver compone calcularRetencionIslr.
export { calcularRetencion1808, resolverConcepto1808, TABLA_1808_DEFECTO } from './retenciones/tabla-1808';
export type {
  TipoPersonaIslr,
  ConceptoIslr1808,
  Tabla1808,
  RetencionPorConceptoInput,
  ResultadoRetencion1808,
} from './retenciones/tabla-1808';

// P22 — Base de retención de ISLR en pagos mixtos servicio+materiales (caso 32, configurable por línea).
export { baseIslrDeLineas } from './retenciones/base-islr-lineas';
export type { LineaIslr, ResultadoBaseIslr } from './retenciones/base-islr-lineas';

// P22 — Evaluación pre-registro de factura de compra: 100% / crédito no deducible + alertas (caso 29).
export { evaluarFacturaCompra } from './retenciones/evaluar-factura-compra';
export type { FacturaCompraAEvaluar, EvaluacionFacturaCompra } from './retenciones/evaluar-factura-compra';

// P22 — Consolidación del ARC anual de ISLR a un sujeto retenido (docs/02 §4).
export { consolidarArcIslr } from './retenciones/arc-islr';
export type { FilaArcIslr, TotalConceptoArc, TotalMesArc, ResultadoArcIslr } from './retenciones/arc-islr';

// P9 — Numeración normada del comprobante de retención (AAAAMMNNNNNNNN) y TXT del portal SENIAT.
export { formatearNumeroComprobante, parsearNumeroComprobante } from './retenciones/comprobante-numero';
export type { PeriodoComprobante, ComprobanteParseado } from './retenciones/comprobante-numero';
// P22 — TXT endurecido (17 columnas: período, % retención, comprobante; golden byte a byte, caso 33).
export { generarTxtRetencionIva } from './retenciones/txt-retencion-iva';
export type {
  TipoDocumentoTxt,
  TipoTransaccionTxt,
  LineaRetencionIvaTxt,
  OpcionesTxt,
} from './retenciones/txt-retencion-iva';

// P10 — Resumen del Libro de Compras / Ventas (Reglamento IVA arts. 70–78; docs/02 §7.2). Misma
// fuente que la declaración → garantiza la triple igualdad libro ≡ documentos ≡ planilla (docs/05 §7.3).
export { resumirLibro } from './libros/resumen-libro';
export type {
  FilaImpuestoLibro,
  OpcionesResumen,
  GrupoResumen,
  ResumenLibro,
} from './libros/resumen-libro';

// P10 — Planilla borrador de IVA (forma 99030; docs/02 §3.2; casos 13, 17, 26, 28, 30) y
// declaración de IGTF percibido (docs/02 §5; casos 34, 35).
export { calcularPlanillaIva } from './declaraciones/planilla-iva';
export type {
  GrupoPlanillaIva,
  PlanillaIvaInput,
  OpcionesPlanillaIva,
  ResultadoPlanillaIva,
} from './declaraciones/planilla-iva';
export { calcularDeclaracionIgtf } from './declaraciones/declaracion-igtf';
export type {
  FilaIgtf,
  OpcionesDeclaracionIgtf,
  GrupoIgtf,
  ResultadoDeclaracionIgtf,
} from './declaraciones/declaracion-igtf';

// P21 — Anticipos quincenales/semanales de IVA e ISLR de SPE sobre ingresos brutos (docs/02 §3.2/§10;
// casos 34, 35 para la no duplicación con el IGTF). Alícuota y cadencia desde fiscal_params (regla 17).
export { calcularAnticipo } from './declaraciones/anticipo';
export type {
  TipoAnticipo,
  AnticipoInput,
  OpcionesAnticipo,
  ResultadoAnticipo,
} from './declaraciones/anticipo';

// P12 — Inventario: kardex y costo promedio ponderado móvil en doble base (docs/03 §4.3, art. 177
// Ley ISLR; casos 37–39). Función pura: el servicio resuelve los stock_moves y este motor valora.
export { calcularKardex, costoVigente, StockInsuficienteError } from './inventario/kardex';
export type {
  TipoMovimientoKardex,
  CostoEntrada,
  MovimientoKardex,
  OpcionesKardex,
  FilaKardex,
  ResumenKardex,
  CostoVigente,
} from './inventario/kardex';

// P15 — Motor de nómina puro (LOTTT; docs/04; casos 47–50). Fórmulas seguras (DSL/AST sin eval),
// salarios normal/integral, parafiscales IVSS/RPE/FAOV/INCES, prestaciones art. 142 (doble cálculo)
// e intereses, recibo de nómina y provisiones mensuales.
export {
  evaluarFormula,
  validarFormula,
  FormulaInvalidaError,
  derivarSalarios,
  resolverSalarioNormalMensual,
  semanasCotizablesDelMes,
  calcularParafiscales,
  calcularPrestacionesArt142,
  interesesPrestaciones,
  calcularReciboNomina,
  calcularProvisionesMes,
  DECIMALES_NOMINA,
} from './nomina';
export type {
  ScopeFormula,
  ValorScope,
  SalariosInput,
  ResultadoSalarios,
  ComponenteSalario,
  RiesgoIvss,
  AlicuotasParafiscales,
  ParafiscalesInput,
  ResultadoParafiscales,
  DetalleRegimen,
  PrestacionesArt142Input,
  ResultadoPrestacionesArt142,
  MovimientoInteres,
  DetalleInteresAnio,
  ResultadoIntereses,
  TipoConcepto,
  ConceptoNomina,
  ReciboInput,
  LineaRecibo,
  ResultadoRecibo,
  ProvisionesMesInput,
  ResultadoProvisionesMes,
} from './nomina';

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
