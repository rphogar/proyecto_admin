/**
 * Representación del **documento fiscal digital** (P24, Providencia SNAT/2024/000102). Conserva TODOS
 * los requisitos de la 00071 (denominación, numeración, número de control, datos del emisor y del
 * adquirente, fecha, descripción con cantidad y precio, descuentos, base e IVA discriminados por
 * alícuota, total, moneda con contravalor en Bs y tasa BCV, condición de pago) y suma los **elementos
 * de control digital** propios de la 00102 (número de control digital + identificador/QR verificable).
 *
 * Es la "verdad presentable" del documento: lo que se **entrega** electrónicamente al adquirente y lo
 * que se **conserva** a disposición del SENIAT (10 años por COT). Estructura PURA y serializable: no
 * depende de la base de datos ni del ORM; el módulo de la API la arma desde el documento emitido.
 */

import type { ControlVerificable } from '../control/control-verificable';

/** Tipos de documento fiscal que admiten emisión digital (00102: factura y sus notas). */
export type TipoDocumentoDigital = 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';

/** Datos del emisor (00071 art. 6.1: razón social, RIF y domicilio fiscal). */
export interface EmisorDigital {
  readonly rif: string;
  readonly razonSocial: string;
  readonly domicilioFiscal: string;
}

/** Datos del adquirente. `esConsumidorFinal` ⇒ venta al detal sin identificación (bajo umbral). */
export interface AdquirenteDigital {
  readonly esConsumidorFinal: boolean;
  readonly rif: string | null;
  readonly nombre: string | null;
}

/** Línea del documento (descripción, cantidad y precio + alícuota y base/IVA discriminados). */
export interface LineaDigital {
  readonly lineaNo: number;
  readonly descripcion: string;
  readonly cantidad: string;
  readonly precioUnitario: string;
  readonly descuento: string | null;
  readonly alicuotaCodigo: string;
  readonly alicuotaTasa: string;
  readonly baseOrigen: string;
  readonly ivaOrigen: string;
}

/** Impuesto discriminado por alícuota (fuente única de libros y declaración). */
export interface ImpuestoDigital {
  readonly alicuotaCodigo: string;
  readonly alicuotaTasa: string;
  readonly base: string;
  readonly monto: string;
}

/** Referencia a la factura afectada (obligatoria en NC/ND). */
export interface DocumentoAfectadoDigital {
  readonly numero: string;
  readonly fecha: string;
  readonly monto: string;
}

/** Documento fiscal digital completo (requisitos 00071 + control digital 00102). */
export interface DocumentoDigital {
  readonly tipoDocumento: TipoDocumentoDigital;
  readonly emisor: EmisorDigital;
  readonly serie: string;
  /** Correlativo de software de la serie (consecutivo sin huecos, docs/05 §4). */
  readonly numero: number;
  /** Número de control DIGITAL asignado por la imprenta digital autorizada (00102). */
  readonly numeroControl: string;
  readonly adquirente: AdquirenteDigital;
  /** Instante de emisión (UTC, ISO). */
  readonly fechaEmision: string;
  /** Fecha fiscal civil en Caracas `YYYY-MM-DD` (corta períodos y libros, regla 15). */
  readonly fechaFiscal: string;
  readonly moneda: string;
  /** Tasa BCV congelada (Bs por unidad de `moneda`); null si VES. */
  readonly rateBcv: string | null;
  readonly totalOrigen: string;
  /** Contravalor del total en Bs (verdad fiscal); = totalOrigen si VES. */
  readonly totalVes: string;
  readonly condicionPago: 'CONTADO' | 'CREDITO';
  readonly lineas: ReadonlyArray<LineaDigital>;
  readonly impuestos: ReadonlyArray<ImpuestoDigital>;
  readonly documentoAfectado: DocumentoAfectadoDigital | null;
  /** Hash de integridad del documento emitido (cadena inviolable, Providencia 121). */
  readonly hashIntegridad: string;
  /** Elementos de control digital verificables (identificador + QR + URL de verificación). */
  readonly control: ControlVerificable;
}

/** Entrada para construir el documento digital desde el documento ya emitido. */
export interface EntradaDocumentoDigital {
  readonly tipoDocumento: TipoDocumentoDigital;
  readonly emisor: EmisorDigital;
  readonly serie: string;
  readonly numero: number;
  readonly numeroControl: string;
  readonly adquirente: AdquirenteDigital;
  readonly fechaEmision: string;
  readonly fechaFiscal: string;
  readonly moneda: string;
  readonly rateBcv: string | null;
  readonly totalOrigen: string;
  readonly totalVes: string;
  readonly condicionPago: 'CONTADO' | 'CREDITO';
  readonly lineas: ReadonlyArray<LineaDigital>;
  readonly impuestos: ReadonlyArray<ImpuestoDigital>;
  readonly documentoAfectado?: DocumentoAfectadoDigital | null;
  readonly hashIntegridad: string;
  readonly control: ControlVerificable;
}

/**
 * Ensambla el documento digital a partir del documento emitido. Función PURA y determinista (mismo
 * input ⇒ mismo output): facilita los golden tests del ciclo emisión→control→entrega. No valida los
 * requisitos de la 00071 (eso ya lo hizo el validador pre-emisión del motor fiscal antes de emitir):
 * aquí solo se reúnen para la entrega y la conservación.
 */
export function construirDocumentoDigital(e: EntradaDocumentoDigital): DocumentoDigital {
  return {
    tipoDocumento: e.tipoDocumento,
    emisor: e.emisor,
    serie: e.serie,
    numero: e.numero,
    numeroControl: e.numeroControl,
    adquirente: e.adquirente,
    fechaEmision: e.fechaEmision,
    fechaFiscal: e.fechaFiscal,
    moneda: e.moneda,
    rateBcv: e.rateBcv,
    totalOrigen: e.totalOrigen,
    totalVes: e.totalVes,
    condicionPago: e.condicionPago,
    lineas: e.lineas,
    impuestos: e.impuestos,
    documentoAfectado: e.documentoAfectado ?? null,
    hashIntegridad: e.hashIntegridad,
    control: e.control,
  };
}
