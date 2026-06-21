// @contave/imprenta-digital — régimen de factura digital (P24, Providencia SNAT/2024/000102; docs/05
// §5). Paquete PURO: define el adapter ImprentaDigital (punto de extensión único) con sus tres
// responsabilidades (asignar número de control digital, entregar electrónicamente, conservar a
// disposición del SENIAT), la construcción del control verificable (identificador/QR), la
// representación del documento digital, un adapter simulado para CI y el punto de integración futuro de
// la validación en línea del SENIAT (preparado, no implementado). El SaaS nunca habla directo con el
// proveedor: lo hace a través de este adapter (ver docs/13).

// Adapter (contrato + solicitudes + resultados).
export type {
  ImprentaDigital,
  SolicitudControlDigital,
  ResultadoControlDigital,
  SolicitudEntrega,
  DestinatarioEntrega,
  ResultadoEntrega,
  SolicitudConservacion,
  ResultadoConservacion,
} from './adapter/imprenta-digital';

// Representación del documento fiscal digital (requisitos 00071 + control digital 00102).
export { construirDocumentoDigital } from './documento/documento-digital';
export type {
  DocumentoDigital,
  EntradaDocumentoDigital,
  TipoDocumentoDigital,
  EmisorDigital,
  AdquirenteDigital,
  LineaDigital,
  ImpuestoDigital,
  DocumentoAfectadoDigital,
} from './documento/documento-digital';

// Control digital verificable (identificador + QR + URL de verificación).
export { construirControlVerificable } from './control/control-verificable';
export type { ControlVerificable, DatosControlVerificable } from './control/control-verificable';

// Adapter simulado (default en CI y en el SaaS hasta integrar una imprenta autorizada).
export { ImprentaDigitalSimulada } from './simulada/imprenta-simulada';

// Punto de integración futuro: validación en línea del SENIAT (preparado, no implementado).
export { ValidacionEnLineaNoDisponible } from './seniat/validacion-en-linea';
export type {
  ValidacionEnLineaSeniat,
  ResultadoValidacionSeniat,
  AcuseValidacionSeniat,
} from './seniat/validacion-en-linea';
