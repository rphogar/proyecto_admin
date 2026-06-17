import { Injectable } from '@nestjs/common';

/**
 * Adapter de remisión de registros de facturación al SENIAT (P17, Providencia 121 §6.3 req. 2).
 * Punto de extensión ÚNICO del módulo desacoplado: hoy es un stub porque el SENIAT no ha publicado el
 * canal técnico; cuando lo publique, se implementa esta interfaz contra el servicio real y nada más
 * cambia (la cola, los reintentos y el acuse ya existen). Ver docs/05 §5.
 */

/** Token de inyección del adapter (permite sustituirlo por el real o por un fake en tests). */
export const REMISION_ADAPTER = Symbol('REMISION_ADAPTER');

/** Resultado de un intento de remisión. */
export type ResultadoRemision =
  | { tipo: 'ACUSADO'; acuseRef: string; acuse: unknown }
  | { tipo: 'REINTENTABLE'; motivo: string }
  | { tipo: 'PERMANENTE'; motivo: string };

export interface RemisionAdapter {
  /** Intenta remitir el `payload` del registro de facturación. No lanza: codifica el desenlace. */
  transmitir(payload: unknown): Promise<ResultadoRemision>;
}

/**
 * Stub por defecto: reporta el canal del SENIAT como **no disponible** (REINTENTABLE), de modo que los
 * ítems permanecen en cola reintentándose con backoff sin marcarse como error permanente. Refleja la
 * realidad regulatoria actual (canal técnico aún no publicado) sin bloquear el flujo de emisión.
 */
@Injectable()
export class StubRemisionAdapter implements RemisionAdapter {
  async transmitir(_payload: unknown): Promise<ResultadoRemision> {
    return {
      tipo: 'REINTENTABLE',
      motivo: 'Canal de remisión SENIAT no disponible (adapter stub; pendiente especificación técnica de la Providencia 121)',
    };
  }
}
