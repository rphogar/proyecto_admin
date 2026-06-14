import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Kardex de inventario y costo promedio ponderado móvil en DOBLE BASE (Bs fiscal / USD gerencial).
 * Función PURA y determinista (docs/03 §4.3, doc 06 M5; casos 37–39 del doc 07). Sin IO: el servicio
 * resuelve los movimientos desde `stock_moves` y este motor reconstruye el kardex y los costos.
 *
 * Método: **promedio ponderado móvil** (default exigido por art. 177 Ley ISLR para el inventario
 * fiscal). En cada ENTRADA el costo promedio se recalcula `(valor_previo + valor_entrada) /
 * (cantidad_previa + cantidad_entrada)`; en cada SALIDA el costo de salida es el promedio VIGENTE y
 * el promedio NO cambia. Todo en las dos bases simultáneamente (caso 37: compras en monedas distintas
 * → promedio correcto en AMBAS bases).
 *
 * Precisión: los valores y cantidades se acumulan internamente como `Decimal` a precisión plena; el
 * redondeo a 8 decimales (regla 1) ocurre SOLO en la salida (snapshot de cada fila). El residuo de
 * división al vaciar el stock se anula (clamp a 0 cuando la cantidad de saldo llega a 0) para que el
 * kardex jamás arrastre céntimos fantasma.
 */

const DEC8 = 8;

function r8(d: Decimal): string {
  return d.toDecimalPlaces(DEC8, REDONDEO_FISCAL).toFixed(DEC8);
}

function qty(d: Decimal): string {
  return d.toFixed(); // cantidad en forma canónica (hasta los decimales que traiga, caso 9)
}

/** Tipo de movimiento de inventario (docs/05 §3.8). Las diferencias de CONTEO se materializan como AJUSTE. */
export type TipoMovimientoKardex =
  | 'COMPRA'
  | 'VENTA'
  | 'AJUSTE'
  | 'TRASLADO'
  | 'DEVOLUCION'
  | 'APERTURA'
  | 'CONTEO';

/**
 * Costo de adquisición de una ENTRADA, en una de dos formas:
 *  A) `{ moneda, costoUnit, rateBcv }` — costo pactado en UNA moneda; la otra base se deriva con la
 *     tasa BCV congelada (compra; caso 37).
 *  B) `{ costoUnitVes, costoUnitUsd }` — ambas bases explícitas; para entradas valoradas al promedio
 *     ponderado vigente (traslado recibido, sobrante de conteo), donde el costo mezcla varias tasas y
 *     por tanto `ves ≠ usd × rate`.
 */
export type CostoEntrada =
  | { readonly moneda: 'VES' | 'USD'; readonly costoUnit: string; readonly rateBcv: string }
  | { readonly costoUnitVes: string; readonly costoUnitUsd: string };

/** Un movimiento de inventario a procesar por el kardex (ya ordenado cronológicamente por el llamador). */
export interface MovimientoKardex {
  readonly tipo: TipoMovimientoKardex;
  /** ENTRADA aumenta el stock; SALIDA lo disminuye. */
  readonly direccion: 'ENTRADA' | 'SALIDA';
  /** Magnitud (> 0) en la unidad del ítem. */
  readonly cantidad: string;
  /**
   * Costo de la ENTRADA (obligatorio si `direccion === 'ENTRADA'`). En SALIDA se IGNORA: el costo de
   * salida es el promedio vigente.
   */
  readonly costo?: CostoEntrada;
  /** Identificador opaco del movimiento (id de `stock_moves`), devuelto en la fila para trazabilidad. */
  readonly referencia?: string;
}

export interface OpcionesKardex {
  /** Permitir que el saldo quede negativo (venta en negativo / backorder, caso 38). Default: false. */
  readonly permitirNegativo?: boolean;
}

/** Fila del kardex: el movimiento valorado + el saldo acumulado tras aplicarlo (snapshot a 8 dp). */
export interface FilaKardex {
  readonly tipo: TipoMovimientoKardex;
  readonly direccion: 'ENTRADA' | 'SALIDA';
  readonly referencia: string | undefined;
  readonly cantidad: string;
  /** Costo unitario aplicado al movimiento en cada base (en SALIDA = promedio vigente). */
  readonly costoUnitVes: string;
  readonly costoUnitUsd: string;
  /** Valor del movimiento (cantidad × costo unitario) en cada base. */
  readonly valorVes: string;
  readonly valorUsd: string;
  /** Saldo acumulado tras el movimiento. */
  readonly saldoCantidad: string;
  readonly saldoValorVes: string;
  readonly saldoValorUsd: string;
  readonly costoPromedioVes: string;
  readonly costoPromedioUsd: string;
}

/** Estado final del kardex tras procesar todos los movimientos. */
export interface ResumenKardex {
  readonly saldoCantidad: string;
  readonly saldoValorVes: string;
  readonly saldoValorUsd: string;
  readonly costoPromedioVes: string;
  readonly costoPromedioUsd: string;
  readonly filas: ReadonlyArray<FilaKardex>;
}

/** Error de stock insuficiente cuando no se permite saldo negativo (caso 38, default bloqueado). */
export class StockInsuficienteError extends Error {
  constructor(
    readonly disponible: string,
    readonly solicitado: string,
  ) {
    super(
      `Stock insuficiente: disponible ${disponible}, se intentó retirar ${solicitado} (venta en negativo deshabilitada, caso 38)`,
    );
    this.name = 'StockInsuficienteError';
  }
}

function costosEntrada(costo: CostoEntrada): { ves: Decimal; usd: Decimal } {
  // Forma B: ambas bases explícitas (entrada valorada al promedio vigente).
  if ('costoUnitVes' in costo) {
    const ves = new Decimal(costo.costoUnitVes);
    const usd = new Decimal(costo.costoUnitUsd);
    if (!ves.isFinite() || ves.lt(0) || !usd.isFinite() || usd.lt(0)) {
      throw new Error('kardex: costoUnitVes/costoUnitUsd no pueden ser negativos');
    }
    return { ves, usd };
  }
  // Forma A: un lado + tasa BCV.
  const rate = new Decimal(costo.rateBcv);
  if (!rate.isFinite() || rate.lte(0)) {
    throw new Error('kardex: rateBcv del costo de entrada debe ser > 0');
  }
  const unit = new Decimal(costo.costoUnit);
  if (!unit.isFinite() || unit.lt(0)) {
    throw new Error('kardex: costoUnit no puede ser negativo');
  }
  return costo.moneda === 'VES'
    ? { ves: unit, usd: unit.div(rate) }
    : { ves: unit.times(rate), usd: unit };
}

/**
 * Reconstruye el kardex en doble base. Devuelve cada fila valorada y el estado final con el costo
 * promedio ponderado en Bs y USD. No muta la entrada.
 */
export function calcularKardex(
  movimientos: ReadonlyArray<MovimientoKardex>,
  opciones: OpcionesKardex = {},
): ResumenKardex {
  let saldoCant = new Decimal(0);
  let valorVes = new Decimal(0);
  let valorUsd = new Decimal(0);
  const filas: FilaKardex[] = [];

  for (const mov of movimientos) {
    const cant = new Decimal(mov.cantidad);
    if (!cant.isFinite() || cant.lte(0)) {
      throw new Error(`kardex: cantidad debe ser > 0 (movimiento ${mov.referencia ?? mov.tipo})`);
    }

    let costoUnitVes: Decimal;
    let costoUnitUsd: Decimal;

    if (mov.direccion === 'ENTRADA') {
      if (mov.costo === undefined) {
        throw new Error(
          `kardex: una ENTRADA requiere costo (movimiento ${mov.referencia ?? mov.tipo})`,
        );
      }
      const c = costosEntrada(mov.costo);
      costoUnitVes = c.ves;
      costoUnitUsd = c.usd;
      saldoCant = saldoCant.plus(cant);
      valorVes = valorVes.plus(cant.times(c.ves));
      valorUsd = valorUsd.plus(cant.times(c.usd));
    } else {
      // SALIDA: el costo es el promedio vigente; el promedio no cambia.
      if (!opciones.permitirNegativo && cant.gt(saldoCant)) {
        throw new StockInsuficienteError(qty(saldoCant), qty(cant));
      }
      costoUnitVes = saldoCant.isZero() ? new Decimal(0) : valorVes.div(saldoCant);
      costoUnitUsd = saldoCant.isZero() ? new Decimal(0) : valorUsd.div(saldoCant);
      saldoCant = saldoCant.minus(cant);
      valorVes = valorVes.minus(cant.times(costoUnitVes));
      valorUsd = valorUsd.minus(cant.times(costoUnitUsd));
      // Al vaciar el stock, anula el residuo de división (céntimos fantasma).
      if (saldoCant.isZero()) {
        valorVes = new Decimal(0);
        valorUsd = new Decimal(0);
      }
    }

    const promVes = saldoCant.isZero() ? new Decimal(0) : valorVes.div(saldoCant);
    const promUsd = saldoCant.isZero() ? new Decimal(0) : valorUsd.div(saldoCant);

    filas.push({
      tipo: mov.tipo,
      direccion: mov.direccion,
      referencia: mov.referencia,
      cantidad: qty(cant),
      costoUnitVes: r8(costoUnitVes),
      costoUnitUsd: r8(costoUnitUsd),
      valorVes: r8(cant.times(costoUnitVes)),
      valorUsd: r8(cant.times(costoUnitUsd)),
      saldoCantidad: qty(saldoCant),
      saldoValorVes: r8(valorVes),
      saldoValorUsd: r8(valorUsd),
      costoPromedioVes: r8(promVes),
      costoPromedioUsd: r8(promUsd),
    });
  }

  return {
    saldoCantidad: qty(saldoCant),
    saldoValorVes: r8(valorVes),
    saldoValorUsd: r8(valorUsd),
    costoPromedioVes: r8(saldoCant.isZero() ? new Decimal(0) : valorVes.div(saldoCant)),
    costoPromedioUsd: r8(saldoCant.isZero() ? new Decimal(0) : valorUsd.div(saldoCant)),
    filas,
  };
}

/** Estado de costo vigente (promedio ponderado) a partir de un saldo previo, para valorar una SALIDA. */
export interface CostoVigente {
  readonly saldoCantidad: string;
  readonly costoPromedioVes: string;
  readonly costoPromedioUsd: string;
}

/**
 * Costo promedio vigente tras procesar `movimientos` (azúcar sobre {@link calcularKardex}). Lo usa el
 * servicio para valorar una VENTA/AJUSTE de salida al promedio actual (caso 38: el recosteo posterior
 * solo ajusta el período abierto).
 */
export function costoVigente(
  movimientos: ReadonlyArray<MovimientoKardex>,
  opciones: OpcionesKardex = {},
): CostoVigente {
  const k = calcularKardex(movimientos, opciones);
  return {
    saldoCantidad: k.saldoCantidad,
    costoPromedioVes: k.costoPromedioVes,
    costoPromedioUsd: k.costoPromedioUsd,
  };
}
