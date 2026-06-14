import { Decimal, type VentanaFechas } from '@contave/shared';

/**
 * Helpers puros del Dashboard (P14, docs/06 M0): bucketización de ventas por ventana, variación
 * porcentual y aritmética de calendario sobre fechas civiles. Sin IO ni dependencias de Nest → se
 * prueban en unidad sin base de datos (regla de TDD para la lógica derivada).
 */

/** Monto en las dos bases del dashboard (2 decimales de presentación). */
export interface MontoDoble {
  readonly ves: string;
  readonly usd: string;
}

/** Fila mínima de venta para agregar por ventana (espejo de columnas de `documents`). */
export interface FilaVenta {
  readonly tipo: string;
  readonly fecha: string;
  readonly ves: string | null;
  readonly usd: string | null;
}

/**
 * Suma las ventas NETAS dentro de la ventana `[desde, hasta]` (inclusive): factura/ND suman, nota de
 * crédito resta. Los montos vienen ya en doble base; aquí solo se agregan con `Decimal` (regla 1).
 */
export function sumaVentas(filas: ReadonlyArray<FilaVenta>, v: VentanaFechas): { ves: Decimal; usd: Decimal } {
  let ves = new Decimal(0);
  let usd = new Decimal(0);
  for (const f of filas) {
    if (f.fecha < v.desde || f.fecha > v.hasta) continue;
    const signo = f.tipo === 'NOTA_CREDITO' ? -1 : 1;
    ves = ves.plus(new Decimal(f.ves ?? '0').times(signo));
    usd = usd.plus(new Decimal(f.usd ?? '0').times(signo));
  }
  return { ves, usd };
}

export function dobleMonto(m: { ves: Decimal; usd: Decimal }): MontoDoble {
  return { ves: m.ves.toFixed(2), usd: m.usd.toFixed(2) };
}

export function ceroDoble(): MontoDoble {
  return { ves: '0.00', usd: '0.00' };
}

/** Variación porcentual de `actual` sobre `anterior` (1 decimal); null si la base es cero. */
export function variacion(actual: Decimal, anterior: Decimal): string | null {
  if (anterior.isZero()) return null;
  return actual.minus(anterior).div(anterior).times(100).toFixed(1);
}

/** Redondea una cadena decimal a `decimales` posiciones (presentación). */
export function dos(valor: string, decimales = 2): string {
  return new Decimal(valor).toFixed(decimales);
}

/** Suma `dias` a una fecha civil `'YYYY-MM-DD'` y devuelve `'YYYY-MM-DD'`. */
export function sumarDias(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Días enteros entre dos fechas civiles (`a − b`); positivo si `a` es posterior a `b`. */
export function diferenciaDias(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function periodoPrevio(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

export function periodoSiguiente(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}
