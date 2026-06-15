import type { AlicuotasParafiscales, RiesgoIvss } from '@contave/fiscal-engine';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { fiscalParams } from '../db/schema';

/**
 * Helpers compartidos por los servicios de nómina (P15). Resuelven parámetros normativos desde
 * `fiscal_params` (regla 17: nunca hardcodeados) y exponen los valores por defecto marcados como
 * pendientes de validación profesional. Todo se ejecuta DENTRO de `withTenant` (RLS).
 */

export { cargarCuentas, requerirPeriodoAbierto } from '../tesoreria/tesoreria-comun';

/**
 * Alícuotas parafiscales por defecto (docs/04 §3). Se usan si el tenant no tiene el parámetro
 * `alicuotas_parafiscales` vigente. TODO-TRIBUTARISTA: validar tasas, topes y clases de riesgo
 * vigentes con un tributarista/laboralista; sembrar por tenant en `fiscal_params`.
 */
export const ALICUOTAS_PARAFISCALES_DEFECTO: AlicuotasParafiscales = {
  ivss: { trabajador: 4, patronoPorRiesgo: { minimo: 9, medio: 10, maximo: 11 }, topeSalariosMinimos: 5 },
  rpe: { trabajador: 0.5, patrono: 2, topeSalariosMinimos: 10 },
  faov: { trabajador: 1, patrono: 2 },
  inces: { trabajador: 0.5, patrono: 2 },
};

export interface ParametrosNomina {
  readonly salarioMinimoMensual: string;
  readonly cestaticketMensual: string;
  readonly ut: string;
  readonly alicuotas: AlicuotasParafiscales;
}

/** Lee el valor vigente de un parámetro de `fiscal_params` a la fecha fiscal `YYYY-MM-DD`. */
export async function leerParametro(
  tx: DatabaseTx,
  clave: string,
  fecha: string,
): Promise<unknown | undefined> {
  const [fila] = await tx
    .select({ valor: fiscalParams.valor })
    .from(fiscalParams)
    .where(
      and(
        eq(fiscalParams.clave, clave),
        lte(fiscalParams.vigenteDesde, fecha),
        or(isNull(fiscalParams.vigenteHasta), gt(fiscalParams.vigenteHasta, fecha)),
      ),
    )
    .orderBy(desc(fiscalParams.vigenteDesde))
    .limit(1);
  return fila?.valor;
}

function aMonto(valor: unknown, defecto: string): string {
  if (valor === null || valor === undefined) return defecto;
  if (typeof valor === 'object' && valor !== null && 'monto' in valor) {
    return String((valor as { monto: unknown }).monto);
  }
  return String(valor);
}

/**
 * Resuelve los parámetros de nómina (salario mínimo, cestaticket, UT y alícuotas) vigentes a la
 * fecha. Los valores nacionales se siembran por tenant (decisión P2); si faltan, se usan los
 * defaults marcados TODO-TRIBUTARISTA para no bloquear el cálculo.
 */
export async function cargarParametrosNomina(tx: DatabaseTx, fecha: string): Promise<ParametrosNomina> {
  const [salMin, cesta, ut, alic] = await Promise.all([
    leerParametro(tx, 'salario_minimo', fecha),
    leerParametro(tx, 'cestaticket', fecha),
    leerParametro(tx, 'ut', fecha),
    leerParametro(tx, 'alicuotas_parafiscales', fecha),
  ]);

  return {
    // TODO-TRIBUTARISTA: confirmar los valores vigentes; sembrar en fiscal_params por tenant.
    salarioMinimoMensual: aMonto(salMin, '130'),
    cestaticketMensual: aMonto(cesta, '0'),
    ut: aMonto(ut, '9'),
    alicuotas: (alic as AlicuotasParafiscales | undefined) ?? ALICUOTAS_PARAFISCALES_DEFECTO,
  };
}

/** Normaliza la clase de riesgo IVSS (minimo|medio|maximo); por defecto 'medio'. */
export function normalizarRiesgo(valor: string | null | undefined): RiesgoIvss {
  const v = (valor ?? '').trim().toLowerCase();
  if (v === 'minimo' || v === 'medio' || v === 'maximo') return v;
  return 'medio';
}

/** Etiqueta de período mensual `YYYY-MM`. */
export function etiquetaMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}
