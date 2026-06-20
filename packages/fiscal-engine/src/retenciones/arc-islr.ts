import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Consolidación del **ARC anual de ISLR** (Comprobante / Relación Anual de Retenciones; docs/02 §4:
 * "el agente emite el ARC anual a cada trabajador/proveedor"). Función PURA y determinista.
 *
 * Agrupa las retenciones de ISLR EMITIDAS a un mismo sujeto retenido en un ejercicio fiscal y produce
 * los totales por concepto y por mes, más el gran total de base y retenido. La base fiscal es VES (la
 * planilla y el ARC se expresan en bolívares). El servicio resuelve las filas desde `retentions_issued`
 * (tipo ISLR) y este motor solo agrega: una sola fuente de verdad, sin recalcular.
 */

export interface FilaArcIslr {
  /** Mes del período de imputación (1–12). */
  readonly mes: number;
  /** Código de concepto del Decreto 1.808 (o descripción estable). */
  readonly concepto: string;
  /** Base de retención en VES. */
  readonly baseVes: string | number;
  /** Monto retenido en VES. */
  readonly montoVes: string | number;
}

export interface TotalConceptoArc {
  readonly concepto: string;
  readonly baseVes: string;
  readonly retenidoVes: string;
  /** Número de comprobantes agregados en este concepto. */
  readonly comprobantes: number;
}

export interface TotalMesArc {
  readonly mes: number;
  readonly baseVes: string;
  readonly retenidoVes: string;
}

export interface ResultadoArcIslr {
  /** Totales por concepto (ordenados por código de concepto). */
  readonly porConcepto: TotalConceptoArc[];
  /** Totales por mes (1–12 con movimiento, ordenados). */
  readonly porMes: TotalMesArc[];
  /** Gran total de la base retenida del ejercicio. */
  readonly baseTotalVes: string;
  /** Gran total de ISLR retenido del ejercicio. */
  readonly retenidoTotalVes: string;
  /** Número de comprobantes incluidos. */
  readonly comprobantes: number;
}

function r2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, REDONDEO_FISCAL);
}

/** Consolida las filas de retención de ISLR emitidas en el ARC anual de un sujeto retenido. */
export function consolidarArcIslr(filas: ReadonlyArray<FilaArcIslr>): ResultadoArcIslr {
  const porConcepto = new Map<string, { base: Decimal; retenido: Decimal; n: number }>();
  const porMes = new Map<number, { base: Decimal; retenido: Decimal }>();
  let baseTotal = new Decimal(0);
  let retenidoTotal = new Decimal(0);

  for (const f of filas) {
    const base = new Decimal(f.baseVes);
    const retenido = new Decimal(f.montoVes);

    const c = porConcepto.get(f.concepto) ?? { base: new Decimal(0), retenido: new Decimal(0), n: 0 };
    porConcepto.set(f.concepto, { base: c.base.plus(base), retenido: c.retenido.plus(retenido), n: c.n + 1 });

    const m = porMes.get(f.mes) ?? { base: new Decimal(0), retenido: new Decimal(0) };
    porMes.set(f.mes, { base: m.base.plus(base), retenido: m.retenido.plus(retenido) });

    baseTotal = baseTotal.plus(base);
    retenidoTotal = retenidoTotal.plus(retenido);
  }

  return {
    porConcepto: [...porConcepto.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([concepto, v]) => ({ concepto, baseVes: r2(v.base).toFixed(2), retenidoVes: r2(v.retenido).toFixed(2), comprobantes: v.n })),
    porMes: [...porMes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([mes, v]) => ({ mes, baseVes: r2(v.base).toFixed(2), retenidoVes: r2(v.retenido).toFixed(2) })),
    baseTotalVes: r2(baseTotal).toFixed(2),
    retenidoTotalVes: r2(retenidoTotal).toFixed(2),
    comprobantes: filas.length,
  };
}
