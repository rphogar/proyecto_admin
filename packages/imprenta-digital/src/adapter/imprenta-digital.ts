import type { DocumentoDigital, TipoDocumentoDigital } from '../documento/documento-digital';

/**
 * Adapter `ImprentaDigital` — PUNTO DE EXTENSIÓN ÚNICO del régimen de factura digital (P24,
 * Providencia SNAT/2024/000102; docs/05 §5). Misma filosofía que `ImpresoraFiscal` (P23) y
 * `RemisionAdapter` (P17): una interfaz limpia que cada **imprenta digital autorizada** implementa por
 * proveedor, y un adapter simulado para CI. Tres responsabilidades del régimen 00102:
 *
 *  1. `asignarControl` — solicita y asigna el **número de control digital** al documento al emitir.
 *  2. `entregar` — **entrega electrónica** (correo u otro medio) del documento con todos los requisitos
 *     de la 00071 + los elementos de control digital (identificador/QR verificable).
 *  3. `conservar` — **conservación digital** del documento a disposición del SENIAT (10 años por COT).
 *
 * Los métodos NO lanzan: codifican el desenlace en uniones discriminadas para que la cola (lado SaaS)
 * decida reintento, error permanente o cierre. El SaaS nunca habla directo con el proveedor: lo hace a
 * través de este adapter (hoy simulado; mañana, el servicio del proveedor autorizado).
 */

/** Solicitud de asignación de número de control digital (datos clave del documento a emitir). */
export interface SolicitudControlDigital {
  readonly rifEmisor: string;
  readonly tipoDocumento: TipoDocumentoDigital;
  readonly serie: string;
  /** Fecha de emisión (UTC, ISO). */
  readonly fechaEmision: string;
  readonly rifAdquirente: string | null;
  /** Total en Bs (verdad fiscal). */
  readonly totalVes: string;
  /** Hash del contenido del documento (integridad; aún sin el número de control). */
  readonly hashContenido: string;
}

/** Resultado de la asignación del número de control digital por la imprenta autorizada. */
export type ResultadoControlDigital =
  | { readonly tipo: 'ASIGNADO'; readonly numeroControl: string; readonly acuse: unknown }
  /** Recuperable: imprenta no disponible / time-out → reintento con backoff. */
  | { readonly tipo: 'REINTENTABLE'; readonly motivo: string }
  /** Definitivo: rechazo del proveedor (datos inválidos, emisor no habilitado). No reintentar. */
  | { readonly tipo: 'PERMANENTE'; readonly motivo: string };

/** Canal de entrega electrónica del documento (00102: correo u otro medio electrónico). */
export interface DestinatarioEntrega {
  readonly canal: 'EMAIL' | 'OTRO';
  /** Dirección de entrega (correo electrónico u otro identificador del canal). */
  readonly direccion: string;
}

/** Solicitud de entrega electrónica del documento digital ya emitido. */
export interface SolicitudEntrega {
  readonly documento: DocumentoDigital;
  readonly destinatario: DestinatarioEntrega;
}

/** Resultado de la entrega electrónica del documento. */
export type ResultadoEntrega =
  | { readonly tipo: 'ENTREGADO'; readonly acuse: unknown; readonly entregadoEn: string }
  | { readonly tipo: 'REINTENTABLE'; readonly motivo: string }
  | { readonly tipo: 'PERMANENTE'; readonly motivo: string };

/** Solicitud de conservación digital del documento a disposición del SENIAT. */
export interface SolicitudConservacion {
  readonly documento: DocumentoDigital;
  /** Años de retención exigidos (10 por COT; 5 mínimo por la 00102). */
  readonly retencionAnios: number;
}

/** Resultado de la conservación digital. */
export type ResultadoConservacion =
  | { readonly tipo: 'CONSERVADO'; readonly referencia: string; readonly acuse: unknown }
  | { readonly tipo: 'REINTENTABLE'; readonly motivo: string }
  | { readonly tipo: 'PERMANENTE'; readonly motivo: string };

export interface ImprentaDigital {
  /** Solicita y asigna el número de control digital al documento (al emitir). */
  asignarControl(solicitud: SolicitudControlDigital): Promise<ResultadoControlDigital>;
  /** Entrega electrónicamente el documento digital al adquirente (correo u otro medio). */
  entregar(solicitud: SolicitudEntrega): Promise<ResultadoEntrega>;
  /** Conserva digitalmente el documento a disposición del SENIAT (retención legal). */
  conservar(solicitud: SolicitudConservacion): Promise<ResultadoConservacion>;
}
