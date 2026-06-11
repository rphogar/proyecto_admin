import DecimalBase from 'decimal.js';

/**
 * Constructor de Decimal configurado para todo ContaVE.
 *
 * Reglas 1–3 de CLAUDE.md: el dinero JAMÁS usa `number`/float. Toda la aritmética
 * monetaria y de tasas se hace sobre este `Decimal`, y la persistencia es `NUMERIC(20,8)`.
 *
 * Se usa `clone()` (no `Decimal.set()`) para NO mutar la configuración global de la
 * librería: así este paquete no interfiere con otros consumidores de decimal.js.
 *
 * - `precision: 40` cubre con margen `NUMERIC(20,8)` y los productos/cocientes intermedios
 *   (tasas BCV de hasta 8 decimales × cantidades) antes de redondear en presentación.
 * - `rounding: ROUND_HALF_UP` = redondeo "half away from zero", que es el half-up fiscal.
 *
 * ledger y fiscal-engine deben importar ESTE `Decimal`, no el de la librería.
 */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
});

/** Tipo de instancia del Decimal configurado. */
export type Decimal = InstanceType<typeof Decimal>;

/** Modo de redondeo fiscal canónico (half-up / half away from zero). */
export const REDONDEO_FISCAL = DecimalBase.ROUND_HALF_UP;
