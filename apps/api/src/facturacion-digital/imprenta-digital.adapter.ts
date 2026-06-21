import { ImprentaDigitalSimulada } from '@contave/imprenta-digital';
import type { ImprentaDigital } from '@contave/imprenta-digital';

/**
 * Token de inyección del adapter `ImprentaDigital` (P24). Permite sustituir la implementación sin tocar
 * el servicio: hoy una **imprenta digital simulada** (CI y despliegue sin proveedor integrado); mañana,
 * el adapter del proveedor de imprenta digital autorizada que asigna los números de control digitales.
 * Misma filosofía que `IMPRESORA_FISCAL` (P23) y `REMISION_ADAPTER` (P17).
 */
export const IMPRENTA_DIGITAL = Symbol('IMPRENTA_DIGITAL');

/** Provider por defecto: imprenta digital simulada en memoria (sin proveedor real). */
export const imprentaDigitalSimuladaProvider = {
  provide: IMPRENTA_DIGITAL,
  useFactory: (): ImprentaDigital => new ImprentaDigitalSimulada(),
};
