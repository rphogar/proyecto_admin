import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Motor de RETENCIÓN DE IVA del agente (Providencia SNAT/2015/0049; docs/02 §3.3; casos 26, 27 y 29
 * del doc 07). Función PURA y determinista.
 *
 * Cuando la empresa es Sujeto Pasivo Especial (agente de retención), al PAGAR a un proveedor retiene
 * una porción del IVA facturado y entera lo retenido al SENIAT:
 *  - **75% del IVA** facturado, regla general.
 *  - **100%** cuando concurre alguno de estos supuestos (Prov. 0049 art. 5): el proveedor no está
 *    inscrito en el RIF o los datos no coinciden, la factura no cumple requisitos (p. ej. no
 *    discrimina el impuesto o no tiene número de control), o el proveedor está en la lista de
 *    "sujetos sin derecho a deducción".
 *
 * El porcentaje base (75/100) llega como **parámetro** resuelto del maestro del tercero
 * (`parties.pct_retencion_iva`); las condiciones que FUERZAN 100% se evalúan con
 * {@link porcentajeRetencionIva} (caso 27: el flag del tercero ya marca 100; caso 29: una factura
 * que no discrimina IVA o sin número de control fuerza 100 aunque el proveedor fuera 75).
 *
 * El monto retenido se calcula sobre el **IVA de la factura** (Σ del IVA por alícuota), redondeado
 * a 2 decimales (half-up), porque el comprobante y el TXT del portal se expresan en Bs con 2
 * decimales. El IVA agnóstico de moneda es responsabilidad del llamador: este motor opera sobre el
 * importe de IVA que recibe (en la base en que se exprese el comprobante, normalmente VES).
 */

/** Porcentaje de retención de IVA admitido por la Providencia 0049. */
export type PorcentajeRetencionIva = 75 | 100;

export interface SeleccionPorcentajeInput {
  /** % base del proveedor (75 o 100), del maestro del tercero. Default 75 si no se conoce. */
  readonly pctProveedor?: PorcentajeRetencionIva | string | number | null;
  /** La factura no discrimina el IVA por alícuota (Prov. 0049 → 100%). */
  readonly noDiscriminaIva?: boolean;
  /** La factura no trae número de control (requisito incumplido → 100%). */
  readonly sinNumeroControl?: boolean;
  /** RIF del proveedor no inscrito o datos que no coinciden (→ 100%). */
  readonly rifInconsistente?: boolean;
}

/**
 * Determina el porcentaje de retención de IVA a aplicar: 75 por defecto/maestro, forzado a 100
 * cuando concurre cualquiera de los supuestos de la Providencia 0049 (casos 27 y 29).
 */
export function porcentajeRetencionIva(input: SeleccionPorcentajeInput = {}): PorcentajeRetencionIva {
  if (input.noDiscriminaIva === true || input.sinNumeroControl === true || input.rifInconsistente === true) {
    return 100;
  }
  const base = input.pctProveedor == null ? 75 : Number(input.pctProveedor);
  return base >= 100 ? 100 : 75;
}

export interface RetencionIvaInput {
  /** IVA total de la factura (Σ del IVA por alícuota), en la moneda del comprobante (normalmente VES). */
  readonly ivaFactura: string | number;
  /** Porcentaje a retener (75 o 100). Resuélvalo con {@link porcentajeRetencionIva}. */
  readonly porcentaje: PorcentajeRetencionIva | string | number;
}

export interface OpcionesRetencion {
  /** Decimales del comprobante (default 2, half-up). */
  readonly decimales?: number;
}

export interface ResultadoRetencionIva {
  /** Porcentaje aplicado ('75' o '100'). */
  readonly porcentaje: string;
  /** IVA de la factura, redondeado. */
  readonly ivaFactura: string;
  /** IVA retenido = ivaFactura × porcentaje, redondeado. */
  readonly ivaRetenido: string;
  /** IVA no retenido = ivaFactura − ivaRetenido (lo que el proveedor sigue cobrando). */
  readonly ivaNoRetenido: string;
}

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`calcularRetencionIva: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularRetencionIva: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularRetencionIva: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Calcula la retención de IVA de una factura de compra. El resto (IVA no retenido) se obtiene por
 * diferencia para que retenido + no retenido == IVA de la factura EXACTAMENTE.
 *
 * @throws si el porcentaje no es 75 ni 100.
 */
export function calcularRetencionIva(
  input: RetencionIvaInput,
  opciones: OpcionesRetencion = {},
): ResultadoRetencionIva {
  const decimales = opciones.decimales ?? 2;
  const pct = Number(input.porcentaje);
  if (pct !== 75 && pct !== 100) {
    throw new Error(`calcularRetencionIva: porcentaje debe ser 75 o 100, no ${String(input.porcentaje)}`);
  }
  const iva = redondear(aDecimal(input.ivaFactura, 'ivaFactura'), decimales);
  const retenido = redondear(iva.times(pct).div(100), decimales);
  const noRetenido = iva.minus(retenido);

  return {
    porcentaje: String(pct),
    ivaFactura: iva.toFixed(decimales),
    ivaRetenido: retenido.toFixed(decimales),
    ivaNoRetenido: noRetenido.toFixed(decimales),
  };
}
