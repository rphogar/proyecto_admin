import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Planilla borrador de la declaración de IVA (forma 99030; Ley del IVA §3.2 de docs/02; casos 13,
 * 17, 26, 28, 30 del doc 07). Función PURA y determinista.
 *
 * Cuota tributaria = débitos − créditos deducibles − excedente de crédito fiscal de períodos
 * anteriores. De la cuota se descuentan las **retenciones de IVA soportadas** acumuladas (las del
 * período + el excedente de retenciones arrastrado). El resultado es:
 *  - una **cuota a pagar** (si los débitos superan a todo lo deducible), o
 *  - un **excedente de crédito fiscal** trasladable (si los créditos superan a los débitos), o
 *  - un **excedente de retenciones** trasladable / recuperable (si las retenciones superan a la
 *    cuota tributaria — caso 30).
 *
 * Las cifras de débito y crédito provienen del MISMO resumen de libros (docs/05 §7.3, triple
 * igualdad): la planilla nunca recalcula impuestos, solo combina los totales del Libro de Ventas
 * (débito) y del Libro de Compras (crédito), aplica la prorrata cuando hay ventas exentas (Ley IVA
 * art. 34) y resta retenciones y excedentes. Trabaja en base fiscal VES, 2 decimales half-up.
 *
 * TODO-TRIBUTARISTA: validar el tratamiento exacto del orden de imputación de excedentes de crédito
 * vs. retenciones y el redondeo normado de la prorrata contra la planilla oficial vigente.
 */

/** Resumen de IVA por alícuota que entra a la planilla (del Libro de Ventas o de Compras). */
export interface GrupoPlanillaIva {
  readonly alicuotaTasa: string;
  readonly base: string;
  readonly monto: string;
}

export interface PlanillaIvaInput {
  /** Débito fiscal (Libro de Ventas): bases e IVA por alícuota. */
  readonly debito: ReadonlyArray<GrupoPlanillaIva>;
  /** Crédito fiscal (Libro de Compras): bases e IVA por alícuota. */
  readonly credito: ReadonlyArray<GrupoPlanillaIva>;
  /** Ventas gravadas del período (para la prorrata; default = Σ bases de débito). */
  readonly ventasGravadas?: string | number;
  /** Ventas exentas + exoneradas + no sujetas del período (para la prorrata). Default 0. */
  readonly ventasExentas?: string | number;
  /**
   * Cuánto del crédito fiscal es COMÚN (no atribuible exclusivamente a gravadas ni a exentas) y por
   * tanto sujeto a prorrata. Default: si hay ventas exentas, todo el crédito es común; si no, 0.
   */
  readonly creditoComun?: string | number;
  /** Retenciones de IVA soportadas en el período (comprobantes recibidos imputados). Default 0. */
  readonly retencionesDelPeriodo?: string | number;
  /** Excedente de crédito fiscal trasladado del período anterior. Default 0. */
  readonly excedenteCreditoAnterior?: string | number;
  /** Excedente de retenciones de IVA trasladado del período anterior. Default 0. */
  readonly excedenteRetencionesAnterior?: string | number;
}

export interface OpcionesPlanillaIva {
  readonly decimales?: number;
}

export interface ResultadoPlanillaIva {
  /** Total de débito fiscal (Σ IVA de ventas gravadas). */
  readonly debitoFiscal: string;
  /** Crédito fiscal del período antes de prorrata (Σ IVA de compras). */
  readonly creditoFiscalDelPeriodo: string;
  /** Porcentaje de prorrata aplicado (gravadas/totales), 2 decimales, para reporte. */
  readonly porcentajeProrrata: string;
  /** Crédito fiscal deducible tras prorrata. */
  readonly creditoFiscalDeducible: string;
  /** Crédito fiscal no deducible que va al costo/gasto (parte común no prorrateable). */
  readonly creditoFiscalAlCosto: string;
  /** Excedente de crédito fiscal del período anterior aplicado. */
  readonly excedenteCreditoAnterior: string;
  /**
   * Cuota tributaria = débito − crédito deducible − excedente crédito anterior. 0 si es negativa
   * (en ese caso el sobrante va a `excedenteCreditoSiguiente`).
   */
  readonly cuotaTributaria: string;
  /** Retenciones de IVA del período. */
  readonly retencionesDelPeriodo: string;
  /** Excedente de retenciones del período anterior. */
  readonly excedenteRetencionesAnterior: string;
  /** Retenciones acumuladas aplicables = período + excedente anterior. */
  readonly retencionesAcumuladas: string;
  /** Cuota a pagar al fisco (≥ 0). */
  readonly cuotaAPagar: string;
  /** Excedente de crédito fiscal trasladable al período siguiente. */
  readonly excedenteCreditoSiguiente: string;
  /** Excedente de retenciones trasladable / recuperable (caso 30). */
  readonly excedenteRetencionesSiguiente: string;
}

function aDecimal(v: string | number | null | undefined, campo: string, def = false): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (def) return new Decimal(0);
    throw new Error(`calcularPlanillaIva: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularPlanillaIva: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite()) throw new Error(`calcularPlanillaIva: ${campo} no es finito: ${String(v)}`);
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

export function calcularPlanillaIva(input: PlanillaIvaInput, opciones: OpcionesPlanillaIva = {}): ResultadoPlanillaIva {
  const decimales = opciones.decimales ?? 2;

  const debitoFiscal = input.debito.reduce((s, g) => s.plus(aDecimal(g.monto, 'debito[].monto')), new Decimal(0));
  const creditoFiscal = input.credito.reduce((s, g) => s.plus(aDecimal(g.monto, 'credito[].monto')), new Decimal(0));

  const ventasGravadas =
    input.ventasGravadas === undefined
      ? input.debito.reduce((s, g) => s.plus(aDecimal(g.base, 'debito[].base')), new Decimal(0))
      : aDecimal(input.ventasGravadas, 'ventasGravadas');
  const ventasExentas = aDecimal(input.ventasExentas, 'ventasExentas', true);

  // Crédito común sujeto a prorrata: por defecto todo el crédito si hay ventas exentas; si no, nada.
  const creditoComun =
    input.creditoComun === undefined ? (ventasExentas.isZero() ? new Decimal(0) : creditoFiscal) : aDecimal(input.creditoComun, 'creditoComun');
  const creditoDirecto = creditoFiscal.minus(creditoComun);
  if (creditoDirecto.isNegative()) {
    throw new Error('calcularPlanillaIva: creditoComun no puede superar el crédito fiscal del período');
  }

  const totalVentas = ventasGravadas.plus(ventasExentas);
  const proporcion = totalVentas.isZero() ? new Decimal(1) : ventasGravadas.div(totalVentas);
  const comunDeducible = redondear(creditoComun.times(proporcion), decimales);
  const comunAlCosto = redondear(creditoComun, decimales).minus(comunDeducible);
  const creditoDeducible = redondear(creditoDirecto, decimales).plus(comunDeducible);

  const excedenteCreditoAnterior = aDecimal(input.excedenteCreditoAnterior, 'excedenteCreditoAnterior', true);
  const retencionesDelPeriodo = aDecimal(input.retencionesDelPeriodo, 'retencionesDelPeriodo', true);
  const excedenteRetencionesAnterior = aDecimal(input.excedenteRetencionesAnterior, 'excedenteRetencionesAnterior', true);

  // Cuota tributaria antes de retenciones.
  const cuotaBruta = debitoFiscal.minus(creditoDeducible).minus(excedenteCreditoAnterior);
  const cuotaTributaria = Decimal.max(cuotaBruta, 0);
  const excedenteCreditoSiguiente = cuotaBruta.isNegative() ? cuotaBruta.negated() : new Decimal(0);

  // Retenciones soportadas acumuladas aplicadas a la cuota tributaria (caso 30).
  const retencionesAcumuladas = retencionesDelPeriodo.plus(excedenteRetencionesAnterior);
  const cuotaAPagar = Decimal.max(cuotaTributaria.minus(retencionesAcumuladas), 0);
  const excedenteRetencionesSiguiente = Decimal.max(retencionesAcumuladas.minus(cuotaTributaria), 0);

  return {
    debitoFiscal: redondear(debitoFiscal, decimales).toFixed(decimales),
    creditoFiscalDelPeriodo: redondear(creditoFiscal, decimales).toFixed(decimales),
    porcentajeProrrata: proporcion.times(100).toDecimalPlaces(2, REDONDEO_FISCAL).toFixed(2),
    creditoFiscalDeducible: creditoDeducible.toFixed(decimales),
    creditoFiscalAlCosto: comunAlCosto.toFixed(decimales),
    excedenteCreditoAnterior: redondear(excedenteCreditoAnterior, decimales).toFixed(decimales),
    cuotaTributaria: redondear(cuotaTributaria, decimales).toFixed(decimales),
    retencionesDelPeriodo: redondear(retencionesDelPeriodo, decimales).toFixed(decimales),
    excedenteRetencionesAnterior: redondear(excedenteRetencionesAnterior, decimales).toFixed(decimales),
    retencionesAcumuladas: redondear(retencionesAcumuladas, decimales).toFixed(decimales),
    cuotaAPagar: redondear(cuotaAPagar, decimales).toFixed(decimales),
    excedenteCreditoSiguiente: redondear(excedenteCreditoSiguiente, decimales).toFixed(decimales),
    excedenteRetencionesSiguiente: redondear(excedenteRetencionesSiguiente, decimales).toFixed(decimales),
  };
}
