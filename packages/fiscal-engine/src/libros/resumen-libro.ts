import { Decimal, REDONDEO_FISCAL } from '@contave/shared';
import type { AlicuotaCodigo } from '../iva/calcular-iva';

/**
 * Resumen mensual del Libro de Compras / Libro de Ventas (Reglamento de la Ley del IVA, arts.
 * 70–78; docs/02 §7.2). Función PURA y determinista.
 *
 * Es la pieza que garantiza el invariante de **triple igualdad** (docs/05 §7.3): el resumen del
 * libro del período se obtiene de las MISMAS filas de impuestos (`document_taxes` / `purchase_taxes`)
 * que alimentan la declaración de IVA, de modo que libro ≡ documentos ≡ planilla. No hay otra fuente
 * de verdad (regla dura §11.8 de docs/02: "si el libro no cuadra con la planilla, hay un bug").
 *
 * Cada documento aporta una o varias filas (una por alícuota). El **factor** captura el signo fiscal:
 * +1 para facturas y notas de débito (suman débito/crédito fiscal) y −1 para notas de crédito (lo
 * restan) — así el neto del período es directamente comparable con la planilla (caso 8, caso 17). El
 * resumen separa las columnas que exige el Reglamento: base imponible e IVA por alícuota, ventas/
 * compras exentas-exoneradas-no sujetas, exportaciones (0%) y total con IVA.
 *
 * Trabaja sobre la **base fiscal en VES** (regla 10): los montos llegan ya redondeados a 2 decimales
 * por documento; aquí solo se suman con signo y se reexpresan a `decimales` (2) sin reintroducir
 * error (la suma de valores a 2 decimales es exacta en Decimal).
 */

/** Renglón de impuesto de un documento que entra al resumen del libro (una alícuota). */
export interface FilaImpuestoLibro {
  readonly alicuotaCodigo: AlicuotaCodigo;
  /** Tasa en PORCENTAJE (16, 8, 31, 0). */
  readonly alicuotaTasa: string | number;
  /** Base imponible en la moneda del libro (VES, base fiscal). */
  readonly base: string | number;
  /** IVA (débito o crédito) en la moneda del libro. */
  readonly monto: string | number;
  /** Signo fiscal: +1 factura/ND (suma), −1 nota de crédito (resta). */
  readonly factor: 1 | -1;
}

export interface OpcionesResumen {
  readonly decimales?: number;
}

/** Renglón gravado del resumen (una dupla código/tasa), con base e IVA netos del período. */
export interface GrupoResumen {
  readonly alicuotaCodigo: AlicuotaCodigo;
  readonly alicuotaTasa: string;
  readonly base: string;
  readonly monto: string;
}

/** Totales del período en las columnas del Reglamento (arts. 70–78). */
export interface ResumenLibro {
  /** Un renglón por alícuota que causa IVA (GENERAL/REDUCIDA/ADICIONAL), orden por tasa desc. */
  readonly grupos: GrupoResumen[];
  /** Σ bases gravadas (causan IVA). */
  readonly baseGravada: string;
  /** Σ IVA (débito fiscal en ventas / crédito fiscal en compras). */
  readonly ivaTotal: string;
  /** Σ bases exentas + exoneradas + no sujetas. */
  readonly baseExenta: string;
  /** Σ bases de exportación (0% con derecho a recuperación). */
  readonly baseExportacion: string;
  /** Σ de TODAS las bases (gravadas + exentas + exportación). */
  readonly baseTotal: string;
  /** Total con IVA = baseTotal + ivaTotal. */
  readonly totalConIva: string;
}

const SIN_IVA: ReadonlySet<AlicuotaCodigo> = new Set<AlicuotaCodigo>(['EXENTO', 'EXONERADO', 'EXPORTACION']);

function aDecimal(v: string | number | null | undefined, campo: string): Decimal {
  if (v === null || v === undefined || String(v).trim() === '') {
    throw new Error(`resumirLibro: ${campo} es obligatorio`);
  }
  let d: Decimal;
  try {
    d = new Decimal(v);
  } catch {
    throw new Error(`resumirLibro: ${campo} no es un número válido: ${String(v)}`);
  }
  if (!d.isFinite()) throw new Error(`resumirLibro: ${campo} no es finito: ${String(v)}`);
  return d;
}

function redondear(d: Decimal, decimales: number): Decimal {
  return d.toDecimalPlaces(decimales, REDONDEO_FISCAL);
}

/**
 * Resume un conjunto de filas de impuestos (de varios documentos) en los totales del libro.
 *
 * Agrupa los renglones gravados por la dupla (código, tasa) aplicando el signo de cada fila; las
 * alícuotas sin causación se acumulan en exentas o exportación. El orden de los grupos es por tasa
 * descendente (y código alfabético a igual tasa) para una salida estable e imprimible.
 */
export function resumirLibro(filas: ReadonlyArray<FilaImpuestoLibro>, opciones: OpcionesResumen = {}): ResumenLibro {
  const decimales = opciones.decimales ?? 2;

  const acum = new Map<string, { codigo: AlicuotaCodigo; tasa: Decimal; base: Decimal; monto: Decimal }>();
  let baseExenta = new Decimal(0);
  let baseExportacion = new Decimal(0);

  filas.forEach((f, i) => {
    if (f.factor !== 1 && f.factor !== -1) {
      throw new Error(`resumirLibro: filas[${i}].factor debe ser 1 o -1`);
    }
    const signo = new Decimal(f.factor);
    const tasa = aDecimal(f.alicuotaTasa, `filas[${i}].alicuotaTasa`);
    const base = aDecimal(f.base, `filas[${i}].base`).times(signo);
    const monto = aDecimal(f.monto, `filas[${i}].monto`).times(signo);

    if (SIN_IVA.has(f.alicuotaCodigo)) {
      if (f.alicuotaCodigo === 'EXPORTACION') baseExportacion = baseExportacion.plus(base);
      else baseExenta = baseExenta.plus(base);
      return;
    }
    const clave = `${f.alicuotaCodigo}@${tasa.toFixed()}`;
    const previo = acum.get(clave);
    if (previo) {
      previo.base = previo.base.plus(base);
      previo.monto = previo.monto.plus(monto);
    } else {
      acum.set(clave, { codigo: f.alicuotaCodigo, tasa, base, monto });
    }
  });

  const grupos = [...acum.values()]
    .sort((a, b) => b.tasa.comparedTo(a.tasa) || a.codigo.localeCompare(b.codigo))
    .map((g) => ({
      alicuotaCodigo: g.codigo,
      alicuotaTasa: g.tasa.toFixed(),
      base: redondear(g.base, decimales).toFixed(decimales),
      monto: redondear(g.monto, decimales).toFixed(decimales),
    }));

  const baseGravada = grupos.reduce((s, g) => s.plus(g.base), new Decimal(0));
  const ivaTotal = grupos.reduce((s, g) => s.plus(g.monto), new Decimal(0));
  const exenta = redondear(baseExenta, decimales);
  const exportacion = redondear(baseExportacion, decimales);
  const baseTotal = baseGravada.plus(exenta).plus(exportacion);
  const totalConIva = baseTotal.plus(ivaTotal);

  return {
    grupos,
    baseGravada: baseGravada.toFixed(decimales),
    ivaTotal: ivaTotal.toFixed(decimales),
    baseExenta: exenta.toFixed(decimales),
    baseExportacion: exportacion.toFixed(decimales),
    baseTotal: baseTotal.toFixed(decimales),
    totalConIva: totalConIva.toFixed(decimales),
  };
}
