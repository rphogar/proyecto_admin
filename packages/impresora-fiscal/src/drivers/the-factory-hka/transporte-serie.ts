/**
 * Transporte físico hacia la máquina fiscal (serie/USB). Se INYECTA en el driver: la implementación
 * real (apertura de puerto COM, baudios, control de flujo, reintentos de bajo nivel) vive en el
 * agente local, no en este paquete, que así permanece puro y testeable en CI (se inyecta un
 * transporte simulado). TODO-HARDWARE: la implementación serie real requiere el equipo físico.
 */

/** Trama lista para enviar al fabricante. `bytes` es la representación de los octetos del protocolo. */
export interface TramaHka {
  /** Comando lógico que originó la trama (diagnóstico/trazabilidad). */
  readonly comando: string;
  /** Cuerpo de la trama (TODO-HARDWARE: codificación de octetos/STX/ETX/checksum reales del SVF). */
  readonly cuerpo: string;
}

/** Respuesta de la máquina a una trama. */
export interface RespuestaTrama {
  readonly ok: boolean;
  /** Código de estado devuelto por la máquina (TODO-HARDWARE: tabla de códigos real del fabricante). */
  readonly codigo: string;
  /** Datos devueltos (p. ej. número/control fiscal al cerrar, contadores en reportes). */
  readonly datos?: Record<string, unknown>;
}

export interface TransporteSerie {
  /** Envía una trama y espera la respuesta de la máquina. Lanza solo ante fallo de transporte. */
  enviar(trama: TramaHka): Promise<RespuestaTrama>;
}
