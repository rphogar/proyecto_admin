import type { DocumentoDigital } from '../documento/documento-digital';

/**
 * PUNTO DE INTEGRACIÓN FUTURO — **validación en línea del SENIAT** (factura electrónica con acuse en
 * tiempo real). P24 deja este camino *preparado pero sin implementar*, como exige la arquitectura:
 *
 *   "Factura digital" ≠ "factura electrónica con validación en línea del SENIAT" (docs/02 §6.2). La
 *   factura digital (00102) asigna el número de control digital vía imprenta autorizada y entrega el
 *   documento; la factura electrónica con **validación en línea** exigiría, ANTES (o en el acto) de
 *   emitir, enviar el documento al SENIAT y recibir un **acuse en tiempo real** (un CUFE/identificador
 *   fiscal validado en línea) que lo habilita. El SENIAT aún no ha publicado este canal técnico.
 *
 * Cuando se publique, este será el punto único a implementar: un adapter `ValidacionEnLineaSeniat` que
 * el flujo de emisión consultará (de forma análoga a `RemisionAdapter`, pero **síncrono y bloqueante**:
 * sin acuse válido no se emite). La cola de remisión asíncrona (P17) cubre el envío *posterior* de
 * registros; ESTO cubriría la validación *previa* en tiempo real. No está cableado en el flujo todavía.
 */

/** Acuse de la validación en línea del SENIAT (forma tentativa; el formato real lo define el SENIAT). */
export interface AcuseValidacionSeniat {
  /** Identificador fiscal único validado por el SENIAT (estilo CUFE). */
  readonly identificadorFiscal: string;
  /** Instante del acuse (ISO). */
  readonly validadoEn: string;
  readonly datos: Record<string, unknown>;
}

/** Resultado de un intento de validación en línea. */
export type ResultadoValidacionSeniat =
  | { readonly tipo: 'VALIDADO'; readonly acuse: AcuseValidacionSeniat }
  | { readonly tipo: 'RECHAZADO'; readonly motivo: string }
  /** El canal de validación en línea aún no está disponible (estado actual). */
  | { readonly tipo: 'NO_DISPONIBLE'; readonly motivo: string };

/**
 * Adapter de validación en línea (futuro). Interfaz declarada para fijar el contrato; su única
 * implementación hoy es {@link ValidacionEnLineaNoDisponible}.
 */
export interface ValidacionEnLineaSeniat {
  /** Valida el documento ante el SENIAT y devuelve el acuse en tiempo real (cuando exista el canal). */
  validar(documento: DocumentoDigital): Promise<ResultadoValidacionSeniat>;
}

/**
 * Implementación por defecto: reporta el canal como **no disponible**. Refleja la realidad regulatoria
 * (canal técnico aún no publicado). NO se invoca en el flujo de factura digital de P24; existe para
 * documentar el contrato y permitir sustituirlo cuando el SENIAT habilite la validación en línea.
 */
export class ValidacionEnLineaNoDisponible implements ValidacionEnLineaSeniat {
  async validar(_documento: DocumentoDigital): Promise<ResultadoValidacionSeniat> {
    return {
      tipo: 'NO_DISPONIBLE',
      motivo:
        'Validación en línea del SENIAT no disponible (canal técnico de factura electrónica en tiempo real ' +
        'aún no publicado; punto de integración preparado, ver Providencia SNAT/2024/000102 §6.2)',
    };
  }
}
