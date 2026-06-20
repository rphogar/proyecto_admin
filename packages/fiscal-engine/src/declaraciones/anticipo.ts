import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Anticipo de IVA / ISLR de los Sujetos Pasivos Especiales (SPE) (docs/02 §3.2/§4/§10; casos 34, 35
 * del doc 07). Función PURA y determinista.
 *
 * Los SPE, además de declarar mensualmente, enteran **anticipos** semanales o quincenales calculados
 * sobre los **ingresos brutos** de la fracción (semana/quincena) a una alícuota fijada por la
 * providencia vigente. El anticipo es un pago a cuenta: se imputa luego contra la cuota mensual de IVA
 * (anticipo de IVA) o contra el ISLR del ejercicio (anticipo de ISLR). De lo calculado se descuentan
 * las retenciones soportadas acumuladas y los anticipos ya enterados en el período, y el resultado es
 * un **anticipo a pagar** (≥ 0) o un **excedente de créditos** trasladable.
 *
 * Invariante anti-duplicación con el IGTF (casos 34/35): la `baseImponible` son los **ingresos brutos**
 * (base de ventas/ingresos del Libro de Ventas). El IGTF percibido vive en los cobros, NUNCA en la base
 * de ingresos ni en `document_taxes`, de modo que jamás entra en el anticipo: el servicio debe pasar
 * como `ingresosBrutos` la base del Libro de Ventas, no el monto cobrado (que incluiría el IGTF).
 *
 * Trabaja en base fiscal VES, 2 decimales half-up. No inventa la alícuota ni la base: ambas llegan como
 * parámetro (la alícuota desde `fiscal_params`, nunca hardcode — regla 17).
 *
 * TODO-TRIBUTARISTA: la **base exacta** (ingresos brutos del período vs. cuota estimada), el
 * **porcentaje** y la **cadencia** (semanal vs. quincenal) los fija la providencia de anticipos
 * vigente para cada SPE; validar contra la providencia antes de producción. Validar también el orden
 * de imputación de retenciones vs. anticipos previos contra la planilla oficial.
 */

export type TipoAnticipo = 'ANTICIPO_IVA' | 'ANTICIPO_ISLR';

export interface AnticipoInput {
  /** Ingresos brutos de la fracción (semana/quincena), en VES. Base del Libro de Ventas, sin IGTF. */
  readonly ingresosBrutos: string | number;
  /** Alícuota del anticipo en % (parámetro con vigencia, nunca hardcode). */
  readonly porcentaje: string | number;
  /** Retenciones de IVA/ISLR soportadas acumuladas aplicables al anticipo. Default 0. */
  readonly retencionesAcumuladas?: string | number;
  /** Anticipos ya enterados en el período (pagos a cuenta previos). Default 0. */
  readonly anticiposPagadosAcumulados?: string | number;
}

export interface OpcionesAnticipo {
  readonly decimales?: number;
}

export interface ResultadoAnticipo {
  /** Base imponible (ingresos brutos) redondeada. */
  readonly baseImponible: string;
  /** Alícuota aplicada en %, para reporte. */
  readonly porcentaje: string;
  /** Anticipo calculado = base × alícuota. */
  readonly anticipoCalculado: string;
  /** Créditos aplicados = retenciones acumuladas + anticipos previos, tope = anticipo calculado. */
  readonly creditosAplicados: string;
  /** Anticipo a pagar al fisco (≥ 0). */
  readonly anticipoAPagar: string;
  /** Excedente de créditos trasladable al período/fracción siguiente (≥ 0). */
  readonly excedenteCreditosSiguiente: string;
}

function aDecimal(v: string | number | null | undefined, campo: string, def = false): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (def) return new Decimal(0);
    throw new Error(`calcularAnticipo: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularAnticipo: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularAnticipo: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

export function calcularAnticipo(input: AnticipoInput, opciones: OpcionesAnticipo = {}): ResultadoAnticipo {
  const decimales = opciones.decimales ?? 2;

  const base = aDecimal(input.ingresosBrutos, 'ingresosBrutos');
  const porcentaje = aDecimal(input.porcentaje, 'porcentaje');
  const retenciones = aDecimal(input.retencionesAcumuladas, 'retencionesAcumuladas', true);
  const anticiposPrevios = aDecimal(input.anticiposPagadosAcumulados, 'anticiposPagadosAcumulados', true);

  // Anticipo calculado a precisión completa; se redondea al exponer.
  const anticipoCalculado = redondear(base.times(porcentaje).div(100), decimales);

  // Créditos disponibles = retenciones soportadas + anticipos ya enterados; tope = lo calculado.
  const creditosDisponibles = redondear(retenciones.plus(anticiposPrevios), decimales);
  const creditosAplicados = Decimal.min(creditosDisponibles, anticipoCalculado);
  const anticipoAPagar = anticipoCalculado.minus(creditosAplicados);
  const excedenteCreditosSiguiente = creditosDisponibles.minus(creditosAplicados);

  return {
    baseImponible: redondear(base, decimales).toFixed(decimales),
    porcentaje: porcentaje.toDecimalPlaces(2, REDONDEO_FISCAL).toFixed(2),
    anticipoCalculado: anticipoCalculado.toFixed(decimales),
    creditosAplicados: creditosAplicados.toFixed(decimales),
    anticipoAPagar: anticipoAPagar.toFixed(decimales),
    excedenteCreditosSiguiente: excedenteCreditosSiguiente.toFixed(decimales),
  };
}
