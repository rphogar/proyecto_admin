import { Decimal, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Declaración borrador de IGTF percibido (Ley del IGTF; docs/02 §5; casos 34, 35 del doc 07).
 * Función PURA y determinista.
 *
 * El SPE designado agente de percepción **percibe** el IGTF (3% por defecto) sobre la porción de los
 * pagos recibida en moneda extranjera/cripto, lo declara y entera según calendario (típicamente
 * quincenal). Esta función agrega las percepciones del período (una fila por pago/documento que
 * causó IGTF) y produce el detalle por alícuota y los totales para la planilla. El IGTF se causa al
 * **pago**, no a la emisión de la factura (caso 35): las filas provienen de los cobros del período.
 *
 * Trabaja en base fiscal VES, 2 decimales half-up. No recalcula el IGTF (lo hizo el motor de IGTF al
 * cobrar y quedó congelado en el cobro): solo suma, de modo que la declaración cuadra con los cobros.
 */

/** Percepción de IGTF de un cobro (base en divisas convertida a Bs e IGTF percibido en Bs). */
export interface FilaIgtf {
  /** Alícuota aplicada en %, (3 por defecto). Parámetro con vigencia, nunca hardcode. */
  readonly alicuota: string | number;
  /** Base imponible (porción en divisas) expresada en Bs. */
  readonly baseVes: string | number;
  /** IGTF percibido en Bs. */
  readonly igtfVes: string | number;
}

export interface OpcionesDeclaracionIgtf {
  readonly decimales?: number;
}

export interface GrupoIgtf {
  readonly alicuota: string;
  readonly baseVes: string;
  readonly igtfVes: string;
  readonly operaciones: number;
}

export interface ResultadoDeclaracionIgtf {
  /** Un renglón por alícuota, orden por alícuota descendente. */
  readonly grupos: GrupoIgtf[];
  /** Σ base imponible (porción en divisas) en Bs. */
  readonly baseTotalVes: string;
  /** Σ IGTF percibido en Bs (a enterar). */
  readonly igtfTotalVes: string;
  /** Cantidad total de operaciones que causaron IGTF. */
  readonly operaciones: number;
}

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`calcularDeclaracionIgtf: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`calcularDeclaracionIgtf: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite() || d.isNegative()) {
    throw new Error(`calcularDeclaracionIgtf: ${campo} debe ser un número ≥ 0: ${String(v)}`);
  }
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

export function calcularDeclaracionIgtf(
  filas: ReadonlyArray<FilaIgtf>,
  opciones: OpcionesDeclaracionIgtf = {},
): ResultadoDeclaracionIgtf {
  const decimales = opciones.decimales ?? 2;
  const acum = new Map<string, { alicuota: Decimal; base: Decimal; igtf: Decimal; ops: number }>();

  filas.forEach((f, i) => {
    const alicuota = aDecimal(f.alicuota, `filas[${i}].alicuota`);
    const base = aDecimal(f.baseVes, `filas[${i}].baseVes`);
    const igtf = aDecimal(f.igtfVes, `filas[${i}].igtfVes`);
    const clave = alicuota.toFixed();
    const previo = acum.get(clave);
    if (previo) {
      previo.base = previo.base.plus(base);
      previo.igtf = previo.igtf.plus(igtf);
      previo.ops += 1;
    } else {
      acum.set(clave, { alicuota, base, igtf, ops: 1 });
    }
  });

  const grupos = [...acum.values()]
    .sort((a, b) => b.alicuota.comparedTo(a.alicuota))
    .map((g) => ({
      alicuota: g.alicuota.toFixed(),
      baseVes: redondear(g.base, decimales).toFixed(decimales),
      igtfVes: redondear(g.igtf, decimales).toFixed(decimales),
      operaciones: g.ops,
    }));

  const baseTotal = grupos.reduce((s, g) => s.plus(g.baseVes), new Decimal(0));
  const igtfTotal = grupos.reduce((s, g) => s.plus(g.igtfVes), new Decimal(0));
  const operaciones = grupos.reduce((s, g) => s + g.operaciones, 0);

  return {
    grupos,
    baseTotalVes: baseTotal.toFixed(decimales),
    igtfTotalVes: igtfTotal.toFixed(decimales),
    operaciones,
  };
}
