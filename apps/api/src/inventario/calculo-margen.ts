import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Detección PURA del **margen negativo en USD** (doc 06 M5: "alerta de margen negativo — precio <
 * costo de reposición USD; error común con inflación"). Sin IO: el servicio resuelve el precio de
 * venta y el costo en USD de cada ítem y esta función marca los que venden por debajo del costo.
 *
 * El criterio es en la base GERENCIAL USD a propósito: con inflación, un precio en Bs que parece
 * sano puede quedar por debajo del costo de reposición en divisas. El margen se evalúa sobre el costo
 * promedio en USD (proxy del costo de reposición; el servicio puede pasar el último costo de compra).
 */

const DEC2 = 2;
const DEC4 = 4;

export interface ItemMargen {
  readonly itemId: string;
  readonly sku: string;
  readonly descripcion: string;
  /** Precio de venta expresado en USD (la lista convertida a USD por el servicio). */
  readonly precioUsd: string;
  /** Costo (promedio o de reposición) en USD. */
  readonly costoUsd: string;
}

export interface FilaMargen {
  readonly itemId: string;
  readonly sku: string;
  readonly descripcion: string;
  readonly precioUsd: string;
  readonly costoUsd: string;
  /** Margen unitario en USD (precio − costo), 4 decimales. */
  readonly margenUsd: string;
  /** Margen % sobre el precio, 2 decimales (vacío si el precio es 0). */
  readonly margenPct: string;
  readonly negativo: boolean;
}

export interface ResultadoMargen {
  readonly filas: ReadonlyArray<FilaMargen>;
  /** Solo los ítems con margen negativo (precio < costo USD). */
  readonly alertas: ReadonlyArray<FilaMargen>;
}

/**
 * Evalúa el margen en USD de cada ítem. Un ítem entra en `alertas` si tiene costo USD > 0 y su precio
 * de venta en USD es estrictamente menor que ese costo. Ítems sin costo (nunca comprados) no alertan.
 */
export function detectarMargenNegativo(items: ReadonlyArray<ItemMargen>): ResultadoMargen {
  const filas = items.map((item): FilaMargen => {
    const precio = new Decimal(item.precioUsd);
    const costo = new Decimal(item.costoUsd);
    const margen = precio.minus(costo);
    const negativo = costo.gt(0) && precio.lt(costo);
    const margenPct = precio.gt(0)
      ? margen.div(precio).times(100).toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2)
      : '';
    return {
      itemId: item.itemId,
      sku: item.sku,
      descripcion: item.descripcion,
      precioUsd: precio.toFixed(DEC2),
      costoUsd: costo.toFixed(DEC2),
      margenUsd: margen.toDecimalPlaces(DEC4, REDONDEO_FISCAL).toFixed(DEC4),
      margenPct,
      negativo,
    };
  });
  return { filas, alertas: filas.filter((f) => f.negativo) };
}
