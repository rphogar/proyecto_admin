import { createHash } from 'node:crypto';

/**
 * Elementos de **control digital verificable** de la factura digital (P24, Providencia
 * SNAT/2024/000102). La 00102 exige que el documento digital incorpore, además del número de control
 * digital, medios que permitan a un tercero **verificar su autenticidad** (típicamente un identificador
 * y un código QR que enlazan con una consulta pública). Esta función arma esos elementos de forma PURA
 * y determinista para que el documento entregado y conservado los lleve.
 *
 * TODO-TRIBUTARISTA: el **formato exacto** del identificador y del contenido del QR (algoritmo, campos,
 * firma) está pendiente de la especificación oficial de la imprenta digital autorizada y del SENIAT.
 * Lo aquí construido es una representación verificable razonable (hash determinista de los campos clave
 * del documento + URL de verificación), aislada tras esta función: cuando se publique la especificación
 * oficial, solo cambia esta construcción, no el resto del flujo.
 */

/** Datos del documento que sellan el identificador verificable (campos fiscales clave). */
export interface DatosControlVerificable {
  readonly rifEmisor: string;
  readonly numeroControl: string;
  readonly tipoDocumento: string;
  readonly serie: string;
  readonly numero: number;
  /** Fecha fiscal civil en Caracas `YYYY-MM-DD`. */
  readonly fechaFiscal: string;
  readonly rifAdquirente: string | null;
  /** Total en Bs (verdad fiscal), con 2 decimales. */
  readonly totalVes: string;
  /** Hash de integridad del documento emitido (lo encadena con la bitácora fiscal). */
  readonly hashIntegridad: string;
  /**
   * Base de la URL pública de verificación (sin barra final). TODO-TRIBUTARISTA: el dominio oficial de
   * consulta lo define el SENIAT/imprenta autorizada; se inyecta como parámetro para no hardcodearlo.
   */
  readonly baseUrlVerificacion: string;
}

/** Elementos de control digital que viajan con el documento entregado/conservado. */
export interface ControlVerificable {
  /** Identificador único verificable (sello determinista de los campos clave del documento). */
  readonly identificador: string;
  /** URL pública para verificar el documento ante el SENIAT/imprenta (consulta del adquirente). */
  readonly urlVerificacion: string;
  /** Contenido textual a codificar en el QR impreso/incrustado en el documento. */
  readonly qr: string;
}

/** Une los campos clave en una cadena canónica estable (orden fijo, separador no presente en RIF/montos). */
function cadenaCanonica(d: DatosControlVerificable): string {
  return [
    d.rifEmisor,
    d.tipoDocumento,
    d.serie,
    String(d.numero),
    d.numeroControl,
    d.fechaFiscal,
    d.rifAdquirente ?? 'CONSUMIDOR_FINAL',
    d.totalVes,
    d.hashIntegridad,
  ].join('|');
}

/**
 * Construye el identificador y el QR verificables del documento digital. Determinista: el mismo
 * documento produce siempre el mismo identificador (idempotencia y golden tests).
 */
export function construirControlVerificable(d: DatosControlVerificable): ControlVerificable {
  const identificador = createHash('sha256').update(cadenaCanonica(d)).digest('hex');
  const base = d.baseUrlVerificacion.replace(/\/+$/, '');
  const urlVerificacion = `${base}/verificar?c=${encodeURIComponent(d.numeroControl)}&id=${identificador}`;
  // TODO-TRIBUTARISTA: el contenido del QR seguirá el formato oficial cuando se publique. Hoy codifica
  // la URL de verificación (que ya lleva número de control + identificador): suficiente para verificar.
  const qr = urlVerificacion;
  return { identificador, urlVerificacion, qr };
}
