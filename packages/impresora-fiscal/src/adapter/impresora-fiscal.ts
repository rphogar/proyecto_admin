import type { ComandoFiscal } from '../mapeo/comando-fiscal';

/**
 * Adapter `ImpresoraFiscal` — PUNTO DE EXTENSIÓN ÚNICO del soporte de impresoras fiscales (P23,
 * docs/05 §5). Misma filosofía que `RemisionAdapter`: una interfaz limpia que cada marca implementa
 * (hoy The Factory HKA; mañana Bematech, …) y un adapter simulado para CI. Los métodos NO lanzan:
 * codifican el desenlace en uniones discriminadas para que la cola (lado SaaS) decida reintento,
 * error o cierre. El SaaS nunca habla con el hardware: lo hace el agente local que cablea el driver.
 */

/** Resultado de imprimir un documento fiscal. La numeración la asigna la memoria fiscal (decisión P23). */
export type ResultadoImpresion =
  | { readonly tipo: 'IMPRESO'; readonly numeroFiscal: string; readonly controlFiscal: string; readonly acuse: unknown }
  /** Recuperable: impresora caída / sin papel / ocupada → contingencia (reintento con backoff). */
  | { readonly tipo: 'REINTENTABLE'; readonly motivo: string }
  /** Definitivo: documento mal formado / rechazo fiscal (no reintentar). */
  | { readonly tipo: 'PERMANENTE'; readonly motivo: string };

/** Datos de un reporte fiscal (X, Z o lectura de memoria). Forma libre por marca (TODO-HARDWARE). */
export interface ReporteFiscal {
  readonly clase: 'X' | 'Z' | 'MEMORIA';
  /** Instante de emisión informado por la máquina (ISO). */
  readonly emitidoEn: string;
  readonly datos: Record<string, unknown>;
}

export type ResultadoReporte =
  | { readonly tipo: 'OK'; readonly reporte: ReporteFiscal }
  | { readonly tipo: 'REINTENTABLE'; readonly motivo: string }
  | { readonly tipo: 'PERMANENTE'; readonly motivo: string };

/** Rango para la lectura de memoria fiscal: por número de cierre Z o por fecha (`YYYY-MM-DD`). */
export interface RangoMemoria {
  readonly desdeZ?: number;
  readonly hastaZ?: number;
  readonly desdeFecha?: string;
  readonly hastaFecha?: string;
}

export interface ImpresoraFiscal {
  /** Imprime un documento fiscal a partir de la secuencia de comandos abstractos. */
  imprimirDocumento(comandos: ComandoFiscal[]): Promise<ResultadoImpresion>;
  /** Reporte X: corte parcial de auditoría (NO cierra el día, no avanza la memoria fiscal). */
  reporteX(): Promise<ResultadoReporte>;
  /** Reporte Z: cierre fiscal diario (avanza el contador de cierres en la memoria fiscal). */
  reporteZ(): Promise<ResultadoReporte>;
  /** Lectura de la memoria fiscal (rango de cierres Z o de fechas). */
  leerMemoriaFiscal(rango?: RangoMemoria): Promise<ResultadoReporte>;
}
