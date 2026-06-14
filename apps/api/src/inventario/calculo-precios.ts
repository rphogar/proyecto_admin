import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO de la actualización masiva de precios (doc 06 M5 "Actualizar precios masivo … por %
 * o por nueva tasa, con vista previa"). Sin IO: 100% testeable. El servicio carga los precios y costos
 * de la lista, llama a esta función para la VISTA PREVIA y solo persiste si el usuario confirma.
 *
 * Modos:
 *  - `PORCENTAJE`: precio nuevo = precio actual × (1 + valor/100). Sube/baja todos un %.
 *  - `MARGEN_COSTO`: precio nuevo = costo × (1 + valor/100). Re-fija el margen sobre el costo promedio
 *    (en la moneda de la lista); evita el margen negativo por inflación (caso del doc 06 M5).
 *  - `TASA`: precio nuevo = precio actual × (tasaNueva / tasaActual). Re-expresa una lista en Bs a una
 *    nueva tasa BCV manteniendo el valor en divisa.
 *
 * Redondeo psicológico opcional sobre el precio nuevo (terminación comercial).
 */

const DEC2 = 2;

export type ModoPrecio = 'PORCENTAJE' | 'MARGEN_COSTO' | 'TASA';
export type RedondeoPsicologico = 'NINGUNO' | 'ENTERO' | 'TERMINACION_99';

export interface ItemPrecioActual {
  readonly itemId: string;
  readonly descripcion: string;
  readonly precioActual: string;
  /** Costo promedio en la moneda de la lista (requerido por `MARGEN_COSTO`). */
  readonly costo?: string | null;
}

export interface ConfigPrecios {
  readonly modo: ModoPrecio;
  /** % (PORCENTAJE/MARGEN_COSTO) o nueva tasa (TASA). */
  readonly valor: string;
  /** Tasa actual de la lista (solo `TASA`). */
  readonly tasaActual?: string | null;
  readonly redondeo?: RedondeoPsicologico;
}

export interface LineaPrecioPreview {
  readonly itemId: string;
  readonly descripcion: string;
  readonly precioActual: string;
  readonly precioNuevo: string;
  /** Variación % del precio (firmada), 2 decimales. */
  readonly variacionPct: string;
  /** True si el ítem no pudo recalcularse (p. ej. `MARGEN_COSTO` sin costo): se deja el precio actual. */
  readonly sinDato: boolean;
}

export interface ResultadoPrecios {
  readonly lineas: ReadonlyArray<LineaPrecioPreview>;
}

function aplicarRedondeo(precio: Decimal, modo: RedondeoPsicologico): Decimal {
  switch (modo) {
    case 'ENTERO':
      return precio.toDecimalPlaces(0, REDONDEO_FISCAL);
    case 'TERMINACION_99': {
      // Termina en .99: redondea al entero más cercano y baja un céntimo (mín. 0,99).
      const entero = precio.toDecimalPlaces(0, REDONDEO_FISCAL);
      const cand = entero.minus('0.01');
      return cand.lt('0.99') ? new Decimal('0.99') : cand;
    }
    default:
      return precio.toDecimalPlaces(DEC2, REDONDEO_FISCAL);
  }
}

function precioNuevo(item: ItemPrecioActual, cfg: ConfigPrecios): Decimal | null {
  const actual = new Decimal(item.precioActual);
  switch (cfg.modo) {
    case 'PORCENTAJE':
      return actual.times(new Decimal(1).plus(new Decimal(cfg.valor).div(100)));
    case 'MARGEN_COSTO': {
      if (item.costo == null || String(item.costo).trim() === '') return null;
      const costo = new Decimal(item.costo);
      if (costo.lte(0)) return null;
      return costo.times(new Decimal(1).plus(new Decimal(cfg.valor).div(100)));
    }
    case 'TASA': {
      if (cfg.tasaActual == null) return null;
      const tasaActual = new Decimal(cfg.tasaActual);
      if (tasaActual.lte(0)) return null;
      return actual.times(new Decimal(cfg.valor).div(tasaActual));
    }
  }
}

export function calcularPreciosMasivo(
  items: ReadonlyArray<ItemPrecioActual>,
  cfg: ConfigPrecios,
): ResultadoPrecios {
  const redondeo = cfg.redondeo ?? 'NINGUNO';
  const lineas = items.map((item): LineaPrecioPreview => {
    const bruto = precioNuevo(item, cfg);
    const actual = new Decimal(item.precioActual);
    if (bruto === null || !bruto.isFinite() || bruto.lt(0)) {
      return {
        itemId: item.itemId,
        descripcion: item.descripcion,
        precioActual: actual.toFixed(DEC2),
        precioNuevo: actual.toFixed(DEC2),
        variacionPct: '0.00',
        sinDato: true,
      };
    }
    const nuevo = aplicarRedondeo(bruto, redondeo);
    const variacion = actual.isZero() ? new Decimal(0) : nuevo.minus(actual).div(actual).times(100);
    return {
      itemId: item.itemId,
      descripcion: item.descripcion,
      precioActual: actual.toFixed(DEC2),
      precioNuevo: nuevo.toFixed(DEC2),
      variacionPct: variacion.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2),
      sinDato: false,
    };
  });
  return { lineas };
}
