import { type EntradaAsiento, type EntradaLinea, ladoOpuesto, type Lado } from '@contave/ledger';
import { Decimal, type InstanteUtc } from '@contave/shared';

/**
 * Motor PURO de aplicación de plantillas de contabilización (P13, docs/03 §5). Toma una versión de
 * plantilla ya resuelta y un contexto con las "magnitudes" (montos con nombre, en triple base) y
 * produce un `EntradaAsiento`. No hace IO; el servicio lo construye/postea/persiste aparte.
 *
 * Convención de signo (regla 1: los montos de línea son SIEMPRE ≥ 0; el lado D/C lleva el signo).
 * Las magnitudes se asumen no negativas; `signo='NEGATIVO'` invierte el lado de la línea (y si por
 * algún motivo la magnitud llegara negativa, también se invierte y se toma su valor absoluto), de
 * modo que el asiento resultante siempre cuadra si la plantilla está bien definida.
 */

/** Monto de una magnitud en las tres bases (origen, VES fiscal, USD gerencial). */
export interface MagnitudMonto {
  readonly origen: string;
  readonly ves: string;
  readonly usd: string;
}

/** Línea de una versión de plantilla resuelta (desde `posting_template_lines`). */
export interface LineaPlantilla {
  readonly lineaNo: number;
  readonly cuentaCodigo: string;
  readonly dc: Lado;
  readonly magnitud: string;
  readonly signo: 'POSITIVO' | 'NEGATIVO';
  readonly esAjuste: boolean;
  readonly usaParty: boolean;
}

/** Versión de plantilla resuelta (cabecera + líneas ordenadas). */
export interface PlantillaResuelta {
  readonly descripcionAsiento: string;
  readonly lineas: ReadonlyArray<LineaPlantilla>;
}

/** Contexto de aplicación: la operación concreta que se contabiliza. */
export interface ContextoAplicacion {
  readonly fecha: InstanteUtc;
  readonly moneda: string;
  readonly rateBcv?: string | null;
  readonly rateUsdMgmt?: string | null;
  /** Montos con nombre que las líneas de la plantilla referencian por `magnitud`. */
  readonly magnitudes: Readonly<Record<string, MagnitudMonto>>;
  readonly partyId?: string;
  readonly companyId?: string;
  readonly sourceId?: string;
  readonly sourceType: string;
  /** Descripción concreta; si se omite, se usa la de la plantilla. */
  readonly descripcion?: string;
}

/** Aplica la plantilla y devuelve el `EntradaAsiento` (aún sin construir/postear). */
export function aplicarPlantilla(plantilla: PlantillaResuelta, ctx: ContextoAplicacion): EntradaAsiento {
  const lineas: EntradaLinea[] = [];

  for (const l of [...plantilla.lineas].sort((a, b) => a.lineaNo - b.lineaNo)) {
    const m = ctx.magnitudes[l.magnitud];
    if (m === undefined) {
      throw new Error(`La plantilla requiere la magnitud "${l.magnitud}", no provista en el contexto`);
    }
    const origen = new Decimal(m.origen);
    const ves = new Decimal(m.ves);
    const usd = new Decimal(m.usd);

    // Línea nula (las tres bases en cero): se omite para no generar ruido en el asiento.
    if (origen.isZero() && ves.isZero() && usd.isZero()) continue;

    // El lado efectivo invierte por `signo='NEGATIVO'` y por una magnitud negativa (doble negación).
    let dc: Lado = l.dc;
    if (l.signo === 'NEGATIVO') dc = ladoOpuesto(dc);
    if (ves.isNegative()) dc = ladoOpuesto(dc);

    lineas.push({
      cuenta: l.cuentaCodigo,
      dc,
      moneda: ctx.moneda,
      montoOrigen: origen.abs().toFixed(),
      montoVes: ves.abs().toFixed(),
      montoUsdMgmt: usd.abs().toFixed(),
      rateBcv: ctx.rateBcv ?? null,
      rateUsdMgmt: ctx.rateUsdMgmt ?? null,
      esAjuste: l.esAjuste,
      ...(l.usaParty && ctx.partyId !== undefined ? { partyId: ctx.partyId } : {}),
    });
  }

  return {
    fecha: ctx.fecha,
    descripcion: ctx.descripcion ?? plantilla.descripcionAsiento,
    lineas,
    sourceType: ctx.sourceType,
    ...(ctx.sourceId !== undefined ? { sourceId: ctx.sourceId } : {}),
    ...(ctx.companyId !== undefined ? { companyId: ctx.companyId } : {}),
  };
}
