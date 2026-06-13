import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Motor de IVA multi-alícuota por documento (Ley del IVA; docs/02 §3; caso 12 y 22 del doc 07).
 *
 * Función PURA y determinista: recibe las líneas de un documento (cada una con su cantidad,
 * precio, descuento y código/tasa de alícuota) y devuelve las **bases imponibles y el IVA
 * discriminados por alícuota**, que son la ÚNICA fuente de verdad de la factura, el libro de
 * ventas/compras y la planilla de declaración (regla dura §11.8 de docs/02: "si el libro no
 * cuadra con la planilla, hay un bug"). La UI jamás calcula impuestos: solo muestra esto.
 *
 * El motor es **agnóstico de moneda**: opera sobre los montos en la moneda de origen del
 * documento. La conversión a la base fiscal VES (× tasa BCV congelada) y a la base gerencial USD
 * es responsabilidad del ledger, que conoce el `exchange_rate_id` (docs/03 §4; ver money.ts).
 *
 * Redondeo (regla 1 de CLAUDE.md): se acumulan las extensiones de línea a precisión completa y
 * SOLO se redondea —half-up, a `decimales`= 2 por defecto— al producir los valores fiscales del
 * documento (base por alícuota e IVA por alícuota). El IVA se calcula sobre la base YA redondeada
 * de cada grupo, de modo que la factura, el libro y la planilla reconcilien exactamente.
 *
 * La alícuota de cada línea llega como **parámetro** (`alicuotaTasa`), nunca hardcodeada: así el
 * motor soporta sin cambios la alícuota general (16%), reducida (8%), adicional suntuaria (+15% =
 * 31%), la adicional por pago en divisas cuando se decrete, y el cambio de alícuota a mitad de mes
 * (caso 14: cada documento usa la tasa vigente a su fecha — regla 17 de CLAUDE.md).
 */

/** Código de alícuota de la línea (mismo dominio que `items.alicuota_iva` y validar-requisitos). */
export type AlicuotaCodigo =
  | 'GENERAL'
  | 'REDUCIDA'
  | 'ADICIONAL'
  | 'EXENTO'
  | 'EXONERADO'
  | 'EXPORTACION';

/** Línea de documento que entra al cálculo de IVA. */
export interface LineaIvaInput {
  readonly alicuotaCodigo: AlicuotaCodigo;
  /** Tasa de la alícuota en PORCENTAJE (16, 8, 31, 0). Parámetro con vigencia, nunca hardcode. */
  readonly alicuotaTasa: string | number;
  readonly cantidad: string | number;
  readonly precioUnitario: string | number;
  /** Descuento de la línea sobre el bruto (cantidad×precio), en monto. Default 0. */
  readonly descuento?: string | number;
}

export interface OpcionesIva {
  /** Decimales de redondeo fiscal del documento (default 2; documentos fiscales = 2, half-up). */
  readonly decimales?: number;
}

/** Resultado discriminado de una alícuota (un renglón de la factura/libro). */
export interface GrupoIva {
  readonly alicuotaCodigo: AlicuotaCodigo;
  readonly alicuotaTasa: string;
  /** Base imponible del grupo, redondeada a `decimales`. */
  readonly baseImponible: string;
  /** IVA del grupo, redondeado a `decimales`. 0 en alícuotas sin causación. */
  readonly iva: string;
  /** `true` si la alícuota causa IVA (GENERAL/REDUCIDA/ADICIONAL). */
  readonly causaIva: boolean;
}

/** Totales del documento, ya con la separación que exige el libro de ventas/compras. */
export interface ResultadoIvaDocumento {
  /** Un renglón por (código, tasa) presente en las líneas, en orden de aparición. */
  readonly grupos: ReadonlyArray<GrupoIva>;
  /** Σ bases de alícuotas que causan IVA (GENERAL/REDUCIDA/ADICIONAL). */
  readonly baseImponibleGravada: string;
  /** Σ IVA (débito o crédito según el documento). */
  readonly ivaTotal: string;
  /** Σ bases exentas + exoneradas (columna "exentas/exoneradas/no sujetas" del libro). */
  readonly baseExenta: string;
  /** Σ bases de exportación (columna "exportaciones" del libro; 0% con derecho a recuperación). */
  readonly baseExportacion: string;
  /** Σ de TODAS las bases (gravadas + exentas + exportación), redondeada. */
  readonly baseTotal: string;
  /** Total del documento = baseTotal + ivaTotal. */
  readonly total: string;
}

/** Alícuotas que NO causan IVA (no generan débito/crédito; su IVA es siempre 0). */
const SIN_IVA: ReadonlySet<AlicuotaCodigo> = new Set<AlicuotaCodigo>([
  'EXENTO',
  'EXONERADO',
  'EXPORTACION',
]);

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`calcularIvaDocumento: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularIvaDocumento: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite()) {
    throw new Error(`calcularIvaDocumento: ${campo} no es finito: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Calcula las bases imponibles y el IVA discriminados por alícuota de un documento.
 *
 * Agrupa por la dupla (código de alícuota, tasa): dos líneas con la misma alícuota suman a un
 * solo renglón; una misma alícuota a dos tasas distintas en un documento (escenario excepcional)
 * produce dos renglones, como exige el libro. El orden de los grupos es el de primera aparición.
 *
 * @throws si una línea trae cantidad/precio/tasa no numéricos o cantidad ≤ 0.
 */
export function calcularIvaDocumento(
  lineas: ReadonlyArray<LineaIvaInput>,
  opciones: OpcionesIva = {},
): ResultadoIvaDocumento {
  const decimales = opciones.decimales ?? 2;

  // Acumulamos la base de cada grupo a PRECISIÓN COMPLETA; redondeamos al final.
  const orden: string[] = [];
  const acum = new Map<string, { codigo: AlicuotaCodigo; tasa: Decimal; base: Decimal }>();

  lineas.forEach((l, i) => {
    const tasa = aDecimal(l.alicuotaTasa, `lineas[${i}].alicuotaTasa`);
    if (tasa.isNegative()) {
      throw new Error(`calcularIvaDocumento: lineas[${i}].alicuotaTasa no puede ser negativa`);
    }
    const cantidad = aDecimal(l.cantidad, `lineas[${i}].cantidad`);
    if (cantidad.lte(0)) {
      throw new Error(`calcularIvaDocumento: lineas[${i}].cantidad debe ser > 0`);
    }
    const precio = aDecimal(l.precioUnitario, `lineas[${i}].precioUnitario`);
    const descuento = l.descuento == null ? new Decimal(0) : aDecimal(l.descuento, `lineas[${i}].descuento`);

    const baseLinea = cantidad.times(precio).minus(descuento);
    if (baseLinea.isNegative()) {
      throw new Error(`calcularIvaDocumento: lineas[${i}] tiene base negativa (descuento > bruto)`);
    }

    // La clave incluye la tasa con precisión completa para no fundir alícuotas distintas.
    const clave = `${l.alicuotaCodigo}@${tasa.toFixed()}`;
    const previo = acum.get(clave);
    if (previo) {
      previo.base = previo.base.plus(baseLinea);
    } else {
      orden.push(clave);
      acum.set(clave, { codigo: l.alicuotaCodigo, tasa, base: baseLinea });
    }
  });

  const grupos: GrupoIva[] = [];
  let baseGravada = new Decimal(0);
  let ivaTotal = new Decimal(0);
  let baseExenta = new Decimal(0);
  let baseExportacion = new Decimal(0);

  for (const clave of orden) {
    const g = acum.get(clave);
    if (!g) continue;
    const causaIva = !SIN_IVA.has(g.codigo);
    const baseRed = redondear(g.base, decimales);
    // IVA sobre la base YA redondeada del grupo → factura, libro y planilla reconcilian.
    const iva = causaIva ? redondear(baseRed.times(g.tasa).div(100), decimales) : new Decimal(0);

    grupos.push({
      alicuotaCodigo: g.codigo,
      alicuotaTasa: g.tasa.toFixed(),
      baseImponible: baseRed.toFixed(decimales),
      iva: iva.toFixed(decimales),
      causaIva,
    });

    if (causaIva) {
      baseGravada = baseGravada.plus(baseRed);
      ivaTotal = ivaTotal.plus(iva);
    } else if (g.codigo === 'EXPORTACION') {
      baseExportacion = baseExportacion.plus(baseRed);
    } else {
      baseExenta = baseExenta.plus(baseRed);
    }
  }

  const baseTotal = baseGravada.plus(baseExenta).plus(baseExportacion);
  const total = baseTotal.plus(ivaTotal);

  return {
    grupos,
    baseImponibleGravada: baseGravada.toFixed(decimales),
    ivaTotal: ivaTotal.toFixed(decimales),
    baseExenta: baseExenta.toFixed(decimales),
    baseExportacion: baseExportacion.toFixed(decimales),
    baseTotal: baseTotal.toFixed(decimales),
    total: total.toFixed(decimales),
  };
}
