// @contave/impresora-fiscal — soporte de impresora fiscal homologada (P23, docs/02 §6.1, docs/05 §5).
// Paquete PURO: define el adapter ImpresoraFiscal (punto de extensión único), el mapeo documento→
// comandos fiscales (determinista, testeable), el driver de The Factory HKA (con transporte serie/USB
// inyectado) y un adapter simulado para CI. El SaaS nunca habla con el hardware: lo hace el agente
// local que cablea el driver (ver docs/12).

// Adapter (contrato + resultados).
export type {
  ImpresoraFiscal,
  ResultadoImpresion,
  ResultadoReporte,
  ReporteFiscal,
  RangoMemoria,
} from './adapter/impresora-fiscal';

// Modelo de comandos abstracto + snapshot del documento + mapeo determinista.
export { mapearDocumentoAComandos } from './mapeo/mapear-documento';
export type {
  ComandoFiscal,
  DocumentoParaImpresion,
  LineaImpresion,
  MedioPagoImpresion,
  AdquirenteImpresion,
  DocumentoAfectadoImpresion,
  TipoDocumentoFiscal,
  CodigoAlicuotaFiscal,
} from './mapeo/comando-fiscal';

// Driver The Factory HKA (primera marca) + transporte serie/USB inyectable.
export { DriverTheFactoryHka } from './drivers/the-factory-hka/driver-hka';
export { construirTramas, tramasDeComando } from './drivers/the-factory-hka/protocolo-hka';
export type { TransporteSerie, TramaHka, RespuestaTrama } from './drivers/the-factory-hka/transporte-serie';

// Adapter simulado (default en CI y en el SaaS hasta que haya hardware).
export { ImpresoraFiscalSimulada } from './simulada/impresora-simulada';
