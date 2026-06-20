import { BadRequestException } from '@nestjs/common';
import {
  resolverConcepto1808,
  sustraendoIslr,
  type Tabla1808,
  TABLA_1808_DEFECTO,
  type TipoPersonaIslr,
} from '@contave/fiscal-engine';
import type { DatabaseTx } from '../db/database.service';
import { leerParametro } from '../nomina/nomina-comun';

/**
 * Resolución de la **tarifa y el sustraendo** de la retención de ISLR desde la tabla 1.808
 * PARAMETRIZABLE (P22, regla 17). El catálogo vive en `fiscal_params` clave `RETENCION_ISLR_1808`
 * (por tenant, con vigencia); si no está sembrado se usa {@link TABLA_1808_DEFECTO} (marcado
 * `esDefecto`). El sustraendo de PN residente se deriva de la UT vigente (`fiscal_params` clave `ut`).
 *
 * Devuelve montos en **bolívares** (el sustraendo se deriva de la UT, que es en Bs); por eso la
 * resolución por tabla se restringe a documentos en VES. Para divisa, el llamador debe pasar
 * `tarifaIslr`/`sustraendoIslr` explícitos. TODO-TRIBUTARISTA: factor del sustraendo, UT y conceptos.
 */

const CLAVE_TABLA_1808 = 'RETENCION_ISLR_1808';

export interface ResueltaIslr {
  /** Descripción legible del concepto (para el comprobante). */
  readonly concepto: string;
  /** Tarifa en % (string). */
  readonly tarifa: string;
  /** Sustraendo en Bs (PN residente; 0 para PJ). */
  readonly sustraendoVes: string;
  /** true si la tabla provino del default (sin parámetro sembrado para el tenant). */
  readonly esDefecto: boolean;
}

/** Extrae un monto escalar de un valor de `fiscal_params` (admite `{ monto }`). */
function montoParam(valor: unknown, defecto: string): string {
  if (valor === null || valor === undefined) return defecto;
  if (typeof valor === 'object' && 'monto' in (valor as Record<string, unknown>)) {
    return String((valor as { monto: unknown }).monto);
  }
  return String(valor);
}

/**
 * Resuelve la retención de ISLR de un concepto y tipo de persona a la fecha fiscal dada, leyendo la
 * tabla 1.808 y la UT de `fiscal_params`. @throws si el concepto no existe o no aplica al tipo de persona.
 */
export async function resolverRetencionIslrTabla(
  tx: DatabaseTx,
  fecha: string,
  params: { conceptoCodigo: string; tipoPersona: TipoPersonaIslr },
): Promise<ResueltaIslr> {
  const valor = await leerParametro(tx, CLAVE_TABLA_1808, fecha);
  const tabla: Tabla1808 = Array.isArray(valor) ? (valor as Tabla1808) : TABLA_1808_DEFECTO;
  const concepto = resolverConcepto1808(tabla, params.conceptoCodigo);
  if (concepto === null) {
    throw new BadRequestException(`Concepto ISLR "${params.conceptoCodigo}" no existe en la tabla 1.808`);
  }
  const tarifa = params.tipoPersona === 'PN_RESIDENTE' ? concepto.tarifaPnResidente : concepto.tarifaPjDomiciliada;
  if (tarifa === null) {
    throw new BadRequestException(`El concepto ${concepto.codigo} no tiene tarifa de ISLR para ${params.tipoPersona}`);
  }

  let sustraendoVes = '0';
  if (params.tipoPersona === 'PN_RESIDENTE' && concepto.aplicaSustraendoPn) {
    const ut = montoParam(await leerParametro(tx, 'ut', fecha), '9'); // default TODO-TRIBUTARISTA
    sustraendoVes = sustraendoIslr({ valorUt: ut, tarifa });
  }

  return { concepto: concepto.descripcion, tarifa, sustraendoVes, esDefecto: !Array.isArray(valor) };
}
