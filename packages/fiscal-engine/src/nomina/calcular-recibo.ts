import { Decimal } from '@contave/shared';
import { redondear } from './comun';
import { evaluarFormula, type ScopeFormula } from './formula';

/**
 * Cálculo del RECIBO de nómina de un trabajador en un período (docs/04 §5). Función pura: evalúa
 * las fórmulas seguras de cada concepto contra el `scope` (variables del trabajador y del período:
 * salario_diario, dias, cestaticket_diario, etc.) y agrega asignaciones y deducciones.
 *
 * Dos pasadas para permitir que las deducciones dependan del bruto: primero se calculan las
 * ASIGNACIONES y se inyectan en el scope `total_asignaciones` y `total_devengado_salarial` (solo
 * conceptos marcados `salarial`, base de las deducciones de ley); luego se calculan las DEDUCCIONES.
 *
 * El prorrateo por ingreso/egreso a mitad de período (casos 47, 52) se modela en el scope: el caller
 * pasa `dias` = días efectivamente laborados y las fórmulas multiplican por `dias`.
 */

export type TipoConcepto = 'ASIGNACION' | 'DEDUCCION';

export interface ConceptoNomina {
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: TipoConcepto;
  /** Fórmula DSL (ver motor de fórmulas). Debe producir un monto ≥ 0. */
  readonly formula: string;
  /** `true` si el concepto integra el salario (base de prestaciones/retenciones). */
  readonly salarial?: boolean;
}

export interface ReciboInput {
  readonly conceptos: readonly ConceptoNomina[];
  /** Variables base del período/trabajador disponibles para las fórmulas. */
  readonly scope: ScopeFormula;
  readonly decimales?: number;
}

export interface LineaRecibo {
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: TipoConcepto;
  readonly salarial: boolean;
  readonly monto: string;
}

export interface ResultadoRecibo {
  readonly lineas: readonly LineaRecibo[];
  readonly totalAsignaciones: string;
  readonly totalDeducciones: string;
  readonly totalDevengadoSalarial: string;
  readonly neto: string;
}

export function calcularReciboNomina(input: ReciboInput): ResultadoRecibo {
  const dec = input.decimales ?? 2;
  const lineas: LineaRecibo[] = [];

  let totalAsignaciones = new Decimal(0);
  let totalDevengadoSalarial = new Decimal(0);

  // Pasada 1: asignaciones.
  for (const c of input.conceptos) {
    if (c.tipo !== 'ASIGNACION') continue;
    const monto = redondear(evaluarFormula(c.formula, input.scope), dec);
    if (monto.isNegative()) {
      throw new Error(`calcularReciboNomina: el concepto '${c.codigo}' produjo un monto negativo`);
    }
    totalAsignaciones = totalAsignaciones.plus(monto);
    if (c.salarial) totalDevengadoSalarial = totalDevengadoSalarial.plus(monto);
    lineas.push({
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: 'ASIGNACION',
      salarial: c.salarial ?? false,
      monto: monto.toFixed(dec),
    });
  }

  // Pasada 2: deducciones, con el bruto disponible en el scope.
  const scopeDeducciones: ScopeFormula = {
    ...input.scope,
    total_asignaciones: totalAsignaciones.toFixed(dec),
    total_devengado_salarial: totalDevengadoSalarial.toFixed(dec),
  };

  let totalDeducciones = new Decimal(0);
  for (const c of input.conceptos) {
    if (c.tipo !== 'DEDUCCION') continue;
    const monto = redondear(evaluarFormula(c.formula, scopeDeducciones), dec);
    if (monto.isNegative()) {
      throw new Error(`calcularReciboNomina: el concepto '${c.codigo}' produjo un monto negativo`);
    }
    totalDeducciones = totalDeducciones.plus(monto);
    lineas.push({
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: 'DEDUCCION',
      salarial: false,
      monto: monto.toFixed(dec),
    });
  }

  const neto = totalAsignaciones.minus(totalDeducciones);

  return {
    lineas,
    totalAsignaciones: totalAsignaciones.toFixed(dec),
    totalDeducciones: totalDeducciones.toFixed(dec),
    totalDevengadoSalarial: totalDevengadoSalarial.toFixed(dec),
    neto: redondear(neto, dec).toFixed(dec),
  };
}
