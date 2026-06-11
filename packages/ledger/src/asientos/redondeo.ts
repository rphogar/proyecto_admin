import { Money } from '@contave/shared';
import { CUENTA_GANANCIA_CAMBIARIA, CUENTA_PERDIDA_CAMBIARIA } from '../cuentas/plan-base';
import { type EntradaLinea, MONEDA_USD_MGMT, MONEDA_VES } from './linea';

/**
 * Ajuste automático de redondeo (docs/03 §4.1.5, caso 9 de docs/07).
 *
 * Al convertir montos en moneda origen a las bases VES/USD con tasas de hasta 8 decimales, el
 * redondeo por línea puede dejar un residuo ≤ el céntimo entre ΣD y ΣC en una base. Esta función
 * inserta una línea de AJUSTE (`esAjuste = true`) contra la cuenta de diferencial/redondeo
 * (ganancia 4.7 / pérdida 6.7) para cuadrar EXACTAMENTE la base, dejando trazado el ajuste.
 *
 * Si el residuo supera la `unidad` (default 0,01) NO es redondeo sino un descuadre real:
 * se lanza, jamás se "absorbe" silenciosamente (regla 11).
 */
export interface OpcionesRedondeo {
  /** Cuenta de ganancia (ΣD>ΣC → crédito). Default 4.7. */
  readonly cuentaGanancia?: string;
  /** Cuenta de pérdida (ΣC>ΣD → débito). Default 6.7. */
  readonly cuentaPerdida?: string;
  /** Tolerancia máxima por base (default '0.01'). Residuos mayores se consideran descuadre real. */
  readonly unidad?: string;
}

function residualBase(
  lineas: ReadonlyArray<EntradaLinea>,
  base: 'VES' | 'USD',
): Money {
  const moneda = base === 'VES' ? MONEDA_VES : MONEDA_USD_MGMT;
  const seleccionar = (l: EntradaLinea): Money =>
    Money.of(base === 'VES' ? l.montoVes : l.montoUsdMgmt, moneda);
  const debe = lineas
    .filter((l) => l.dc === 'D')
    .reduce((acc, l) => acc.suma(seleccionar(l)), Money.cero(moneda));
  const haber = lineas
    .filter((l) => l.dc === 'C')
    .reduce((acc, l) => acc.suma(seleccionar(l)), Money.cero(moneda));
  return debe.resta(haber); // ΣD − ΣC
}

function lineaAjuste(
  base: 'VES' | 'USD',
  residual: Money,
  opciones: Required<OpcionesRedondeo>,
): EntradaLinea {
  // residual = ΣD − ΣC. Si es positivo sobran débitos → falta un crédito (ganancia).
  const esGanancia = residual.esPositivo();
  const monto = residual.valorAbsoluto().aCadenaDecimal();
  return {
    cuenta: esGanancia ? opciones.cuentaGanancia : opciones.cuentaPerdida,
    dc: esGanancia ? 'C' : 'D',
    moneda: base === 'VES' ? MONEDA_VES : MONEDA_USD_MGMT,
    montoOrigen: monto,
    montoVes: base === 'VES' ? monto : '0',
    montoUsdMgmt: base === 'USD' ? monto : '0',
    esAjuste: true,
  };
}

/**
 * Devuelve `lineas` más, de ser necesario, hasta dos líneas de ajuste (una por base VES/USD)
 * que cuadran exactamente cada base. No toca el cuadre por moneda origen (las líneas de ajuste
 * se excluyen de él). Lanza si algún residuo supera la tolerancia.
 */
export function balancearConRedondeo(
  lineas: ReadonlyArray<EntradaLinea>,
  opciones: OpcionesRedondeo = {},
): EntradaLinea[] {
  const config: Required<OpcionesRedondeo> = {
    cuentaGanancia: opciones.cuentaGanancia ?? CUENTA_GANANCIA_CAMBIARIA,
    cuentaPerdida: opciones.cuentaPerdida ?? CUENTA_PERDIDA_CAMBIARIA,
    unidad: opciones.unidad ?? '0.01',
  };

  const resultado: EntradaLinea[] = [...lineas];

  for (const base of ['VES', 'USD'] as const) {
    const residual = residualBase(lineas, base);
    if (residual.esCero()) continue;

    const tolerancia = Money.of(config.unidad, residual.moneda);
    if (residual.valorAbsoluto().mayorQue(tolerancia)) {
      throw new Error(
        `Descuadre en base ${base} de ${residual.aCadenaDecimal()} supera la tolerancia de ` +
          `redondeo (${config.unidad}); no es un ajuste de céntimo sino un error real (regla 11)`,
      );
    }
    resultado.push(lineaAjuste(base, residual, config));
  }

  return resultado;
}
