import type { CodigoMoneda } from '../dinero/money';
import { fechaFiscal, limitesPeriodoMensual, type InstanteUtc } from '../fechas/caracas';

/**
 * Tasa de cambio resuelta en memoria (proyección de una fila de `exchange_rates`).
 *
 * `rate` es un Decimal-string (regla 1 de CLAUDE.md: nunca float) con la precisión exacta
 * publicada por el BCV (hasta 8 decimales). `rateDate` es la fecha de vigencia en hora de
 * Caracas (`'YYYY-MM-DD'`, regla 15). `capturedAt` desempata correcciones del mismo día.
 */
export interface TasaCambio {
  readonly moneda: CodigoMoneda;
  readonly rate: string;
  readonly rateDate: string;
  readonly source: 'BCV' | 'MANUAL' | 'MARKET';
  readonly capturedAt: InstanteUtc;
}

function aEpoch(ts: InstanteUtc): number {
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    throw new Error(`capturedAt inválido: ${String(ts)}`);
  }
  return ms;
}

/**
 * Resuelve la tasa aplicable a `fecha` para `moneda` con la regla **"última tasa publicada
 * anterior"** (docs/05 §3.3, caso 1): la tasa cuyo `rateDate` es el mayor `≤ fecha`. Los fines
 * de semana y feriados quedan cubiertos sin calendario: si no hay fila de ese día, cae a la
 * anterior. Ante dos filas del mismo `rateDate` (una corrección del BCV, caso 3) gana la de
 * `capturedAt` más reciente, que es la vigente para documentos nuevos (los ya emitidos congelan
 * su `exchange_rate_id` y no cambian). Devuelve `null` si no hay ninguna tasa aplicable.
 */
export function rateFor(
  tasas: readonly TasaCambio[],
  fecha: string,
  moneda: CodigoMoneda,
): TasaCambio | null {
  const monedaNorm = moneda.trim().toUpperCase();
  let elegida: TasaCambio | null = null;
  for (const t of tasas) {
    if (t.moneda !== monedaNorm) continue;
    if (t.rateDate > fecha) continue;
    if (elegida === null) {
      elegida = t;
      continue;
    }
    if (t.rateDate > elegida.rateDate) {
      elegida = t;
    } else if (t.rateDate === elegida.rateDate && aEpoch(t.capturedAt) > aEpoch(elegida.capturedAt)) {
      elegida = t;
    }
  }
  return elegida;
}

/**
 * Tasa de cierre de un período mensual: `rateFor` al último día (civil en Caracas) del mes.
 * Insumo de la reexpresión mensual de saldos en divisas (caso 11); la reexpresión en sí
 * (asiento reversible) vive en el módulo de cierre del ledger.
 */
export function tasaDeCierre(
  tasas: readonly TasaCambio[],
  anio: number,
  mes: number,
  moneda: CodigoMoneda,
): TasaCambio | null {
  // `finUtc` = 00:00 (Caracas) del día 1 del mes siguiente; un instante antes es el último día.
  const { finUtc } = limitesPeriodoMensual(anio, mes);
  const ultimoDia = fechaFiscal(new Date(finUtc.getTime() - 1));
  return rateFor(tasas, ultimoDia, moneda);
}
