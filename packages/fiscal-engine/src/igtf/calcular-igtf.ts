import { Decimal, REDONDEO_FISCAL, type CodigoMoneda } from '@contave/shared';

/**
 * Motor del IGTF — Impuesto a las Grandes Transacciones Financieras (Ley del IGTF, reforma 2022;
 * docs/02 §5; casos 4, 34 y 35 del doc 07). Función PURA y determinista.
 *
 * Reglas duras que implementa (docs/02 §5 y §11.5):
 *  1. El IGTF de percepción (3%, alícuota parametrizable) se causa al **PAGO**, no a la emisión de
 *     la factura. Por eso la entrada es un PAGO (sus métodos), no un documento.
 *  2. Se calcula SOLO sobre la **porción pagada en divisas/cripto** (moneda extranjera o cripto no
 *     emitida por la República, sin mediación del sistema bancario nacional). En un pago mixto,
 *     solo la parte en divisas genera IGTF; la parte en bolívares no (caso 4).
 *  3. Lo **percibe** únicamente la empresa que es **Sujeto Pasivo Especial designada agente de
 *     percepción** (`empresaEsPerceptor`). Si no lo es, no se percibe IGTF (caso 34: pago a un no
 *     designado → 0).
 *  4. No forma parte de la base imponible del IVA y no se "absorbe" en redondeos.
 *
 * Causación única (caso 35): como el IGTF se causa por evento de pago, un anticipo en divisas lo
 * causa al recibirse; cuando ese anticipo se aplica luego a la factura no hay nuevo pago en divisas
 * y esta función devuelve 0 → no se duplica. La idempotencia/no duplicación es responsabilidad del
 * que registra los pagos (un pago = un cómputo); este motor solo computa lo que recibe.
 *
 * TODO-TRIBUTARISTA: (a) el IGTF del 2% sobre pagos/débitos en bolívares de los SPE es un hecho
 * distinto (débito bancario propio, no percepción al cliente) y NO se modela aquí; (b) precisar el
 * supuesto exacto de "sin mediación del sistema bancario nacional" que activa `esDivisa`;
 * (c) tratamiento del IGTF ya percibido ante devolución de un pago en divisas (caso 36).
 */

/** Alícuota de percepción del IGTF en %, por defecto 3 (rango legal hasta 8/20, parametrizable). */
export const ALICUOTA_IGTF_DEFECTO = '3';

/** Un método/porción del pago. */
export interface MetodoPagoIgtf {
  readonly moneda: CodigoMoneda;
  /** Monto pagado por este método, en su moneda de origen. */
  readonly montoOrigen: string | number;
  /**
   * `true` si la porción es en divisas/cripto sin mediación del sistema bancario nacional y, por
   * tanto, genera IGTF de percepción (USD efectivo, Zelle, USDT…). Bolívares/transferencia local =
   * `false`. El llamador (que conoce el método de pago) lo determina; no se infiere de la moneda.
   */
  readonly esDivisa: boolean;
  /**
   * Tasa BCV congelada (Bs por unidad de `moneda`) para expresar el IGTF en la base fiscal VES.
   * Obligatoria solo si se quiere el total en Bs y la porción no está en VES.
   */
  readonly rateBcv?: string | number | null;
}

export interface PagoIgtf {
  readonly metodos: ReadonlyArray<MetodoPagoIgtf>;
  /** La empresa que recibe el pago es SPE designada agente de percepción del IGTF. */
  readonly empresaEsPerceptor: boolean;
  /** Alícuota en % (default {@link ALICUOTA_IGTF_DEFECTO}). Parámetro con vigencia. */
  readonly alicuota?: string | number;
}

export interface OpcionesIgtf {
  readonly decimales?: number;
}

/** IGTF causado por una porción/moneda del pago. */
export interface DetalleIgtf {
  readonly moneda: CodigoMoneda;
  /** Base = monto en divisas de esa moneda. */
  readonly base: string;
  /** IGTF en la moneda de origen. */
  readonly igtf: string;
  /** IGTF expresado en Bs (base fiscal), si se proveyó `rateBcv`; si no, null. */
  readonly igtfVes: string | null;
}

export interface ResultadoIgtf {
  /** `true` si la empresa percibe y hay porción en divisas con base > 0. */
  readonly aplica: boolean;
  /** Alícuota aplicada, en %. */
  readonly alicuota: string;
  /** Detalle por moneda en divisas (orden de aparición). */
  readonly detalle: ReadonlyArray<DetalleIgtf>;
  /** Σ IGTF en Bs si TODAS las porciones en divisas traen `rateBcv`; si falta alguna, null. */
  readonly igtfTotalVes: string | null;
}

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`calcularIgtf: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularIgtf: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularIgtf: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Calcula el IGTF percibido por un pago. Agrupa por moneda las porciones en divisas, aplica la
 * alícuota sobre cada base y, si hay tasa, expresa el total en Bs.
 */
export function calcularIgtf(pago: PagoIgtf, opciones: OpcionesIgtf = {}): ResultadoIgtf {
  const decimales = opciones.decimales ?? 2;
  const alicuotaDec = aDecimal(pago.alicuota ?? ALICUOTA_IGTF_DEFECTO, 'alicuota');
  const alicuota = alicuotaDec.toFixed();

  // Sin designación de perceptor no hay percepción, cualquiera sea la moneda (caso 34).
  if (!pago.empresaEsPerceptor) {
    return { aplica: false, alicuota, detalle: [], igtfTotalVes: null };
  }

  // Acumular las porciones en divisas por moneda (preservando rate para el total en Bs).
  const orden: CodigoMoneda[] = [];
  const acum = new Map<CodigoMoneda, { base: Decimal; rate: Decimal | null }>();

  pago.metodos.forEach((m, i) => {
    if (!m.esDivisa) return;
    const monto = aDecimal(m.montoOrigen, `metodos[${i}].montoOrigen`);
    if (monto.isZero()) return;
    const moneda = m.moneda.trim().toUpperCase();
    const rate = m.rateBcv == null ? null : aDecimal(m.rateBcv, `metodos[${i}].rateBcv`);
    const previo = acum.get(moneda);
    if (previo) {
      previo.base = previo.base.plus(monto);
      // Si los rate difieren o falta alguno, el total en Bs no es fiable → se anula.
      if (previo.rate !== null && (rate === null || !rate.equals(previo.rate))) {
        previo.rate = null;
      }
    } else {
      orden.push(moneda);
      acum.set(moneda, { base: monto, rate });
    }
  });

  const detalle: DetalleIgtf[] = [];
  let totalVes = new Decimal(0);
  let totalVesDisponible = orden.length > 0;

  for (const moneda of orden) {
    const g = acum.get(moneda);
    if (!g) continue;
    const igtf = redondear(g.base.times(alicuotaDec).div(100), decimales);
    let igtfVes: string | null = null;
    if (g.rate !== null) {
      const enVes = redondear(igtf.times(g.rate), decimales);
      igtfVes = enVes.toFixed(decimales);
      totalVes = totalVes.plus(enVes);
    } else {
      totalVesDisponible = false;
    }
    detalle.push({
      moneda,
      base: redondear(g.base, decimales).toFixed(decimales),
      igtf: igtf.toFixed(decimales),
      igtfVes,
    });
  }

  return {
    aplica: detalle.length > 0,
    alicuota,
    detalle,
    igtfTotalVes: totalVesDisponible ? totalVes.toFixed(decimales) : null,
  };
}
