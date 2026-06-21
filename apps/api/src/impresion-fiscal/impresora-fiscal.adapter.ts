import { ImpresoraFiscalSimulada } from '@contave/impresora-fiscal';
import type { ImpresoraFiscal } from '@contave/impresora-fiscal';

/**
 * Token de inyección del adapter `ImpresoraFiscal` (P23). Permite sustituir la implementación sin tocar
 * el servicio: hoy una **máquina fiscal simulada** (CI y despliegue sin hardware); mañana, un proxy al
 * agente local que cablea el driver real (The Factory HKA) por serie/USB. Misma filosofía que
 * `REMISION_ADAPTER`.
 */
export const IMPRESORA_FISCAL = Symbol('IMPRESORA_FISCAL');

/** Provider por defecto: máquina fiscal simulada en memoria (sin hardware). */
export const impresoraFiscalSimuladaProvider = {
  provide: IMPRESORA_FISCAL,
  useFactory: (): ImpresoraFiscal => new ImpresoraFiscalSimulada(),
};
