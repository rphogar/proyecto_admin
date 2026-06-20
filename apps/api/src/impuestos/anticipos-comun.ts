import { BadRequestException } from '@nestjs/common';
import type { TipoAnticipo } from '@contave/fiscal-engine';
import type { DatabaseTx } from '../db/database.service';
import { leerParametro } from '../nomina/nomina-comun';
import { rangoPeriodo } from './periodo';

/**
 * Helpers del régimen de anticipos de SPE (P21, docs/02 §3.2/§4/§10). Resuelven el porcentaje y la
 * cadencia desde `fiscal_params` (regla 17: nunca hardcode) y derivan la ventana de fecha fiscal de
 * cada fracción (quincena/semana). Las ventanas y porcentajes definitivos los fija la providencia de
 * anticipos vigente: ver TODO-TRIBUTARISTA.
 */

export type Cadencia = 'QUINCENAL' | 'SEMANAL';

export interface ParametroAnticipo {
  readonly porcentaje: string;
  readonly cadencia: Cadencia;
  /** true si proviene del default TODO-TRIBUTARISTA (no hay parámetro vigente sembrado para el tenant). */
  readonly esDefecto: boolean;
}

/** Clave de `fiscal_params` por tipo de anticipo. Valor jsonb: `{ porcentaje, cadencia }`. */
const CLAVE_PARAM: Record<TipoAnticipo, string> = {
  ANTICIPO_IVA: 'ANTICIPO_IVA_SPE',
  ANTICIPO_ISLR: 'ANTICIPO_ISLR_SPE',
};

/**
 * Defaults SOLO para no bloquear el borrador cuando el tenant aún no tiene el parámetro sembrado.
 * TODO-TRIBUTARISTA: el porcentaje, la base y la cadencia (semanal vs. quincenal) los fija la
 * providencia de anticipos vigente para cada SPE; sembrar en `fiscal_params` y validar con tributarista.
 */
const PARAM_DEFECTO: Record<TipoAnticipo, { porcentaje: string; cadencia: Cadencia }> = {
  ANTICIPO_IVA: { porcentaje: '1', cadencia: 'QUINCENAL' },
  ANTICIPO_ISLR: { porcentaje: '2', cadencia: 'SEMANAL' },
};

/** Lee el porcentaje y la cadencia vigentes del anticipo; cae al default TODO-TRIBUTARISTA si falta. */
export async function resolverParametroAnticipo(
  tx: DatabaseTx,
  tipo: TipoAnticipo,
  fecha: string,
): Promise<ParametroAnticipo> {
  const valor = await leerParametro(tx, CLAVE_PARAM[tipo], fecha);
  if (valor === null || valor === undefined || typeof valor !== 'object') {
    return { ...PARAM_DEFECTO[tipo], esDefecto: true };
  }
  const v = valor as { porcentaje?: unknown; cadencia?: unknown };
  const porcentaje = v.porcentaje === undefined ? PARAM_DEFECTO[tipo].porcentaje : String(v.porcentaje);
  const cadencia = v.cadencia === 'SEMANAL' || v.cadencia === 'QUINCENAL' ? v.cadencia : PARAM_DEFECTO[tipo].cadencia;
  return { porcentaje, cadencia, esDefecto: false };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Días del mes (`mes` 1–12), seguro en UTC (no depende de zona horaria local). */
function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Ventana de fecha fiscal `[desde, hasta)` de la fracción `subperiodo` del mes según la cadencia.
 * QUINCENAL: subperíodo 1 = días 1–15, subperíodo 2 = 16–fin de mes. SEMANAL: bloques de 7 días desde
 * el día 1; el último bloque corta a fin de mes. TODO-TRIBUTARISTA: las ventanas exactas las publica la
 * providencia anual de anticipos; esta es una aproximación hasta importarlas como datos.
 */
export function ventanaFraccion(
  anio: number,
  mes: number,
  cadencia: Cadencia,
  subperiodo: number,
): { desde: string; hasta: string } {
  const { desde: inicioMes, hasta: inicioSigMes } = rangoPeriodo(anio, mes);
  if (!Number.isInteger(subperiodo) || subperiodo < 1) {
    throw new BadRequestException(`subperiodo de anticipo inválido: ${subperiodo} (debe ser ≥ 1)`);
  }

  if (cadencia === 'QUINCENAL') {
    if (subperiodo > 2) throw new BadRequestException('un anticipo quincenal solo tiene subperíodos 1 o 2');
    return subperiodo === 1
      ? { desde: inicioMes, hasta: `${anio}-${pad(mes)}-16` }
      : { desde: `${anio}-${pad(mes)}-16`, hasta: inicioSigMes };
  }

  // SEMANAL.
  if (subperiodo > 5) throw new BadRequestException('un mes tiene a lo sumo 5 fracciones semanales');
  const diasMes = diasEnMes(anio, mes);
  const diaInicio = 1 + (subperiodo - 1) * 7;
  if (diaInicio > diasMes) throw new BadRequestException(`la semana ${subperiodo} no existe en ${anio}-${pad(mes)}`);
  const diaFin = diaInicio + 7;
  return {
    desde: `${anio}-${pad(mes)}-${pad(diaInicio)}`,
    hasta: diaFin > diasMes ? inicioSigMes : `${anio}-${pad(mes)}-${pad(diaFin)}`,
  };
}
