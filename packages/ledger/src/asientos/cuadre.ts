import { type CodigoMoneda, Money } from '@contave/shared';
import type { LineaAsiento } from './linea';
import { MONEDA_USD_MGMT, MONEDA_VES } from './linea';

/**
 * Verificación del invariante de partida doble en TRIPLE base (docs/03 §1 y §4.1.5, regla 7
 * de CLAUDE.md). Decisión de diseño (acordada): se enforced con tolerancia 0:
 *
 *  - VES (base fiscal): ΣD = ΣC SIEMPRE.
 *  - USD (base gerencial): ΣD = ΣC SIEMPRE.
 *  - ORIGEN: ΣD = ΣC por cada `currency_code`, considerando SOLO líneas operativas. Las líneas
 *    de ajuste (`esAjuste = true`: diferencial cambiario / redondeo) se EXCLUYEN del cuadre por
 *    origen porque existen para reconciliar una base, no el origen (docs/03 §4.2).
 */

export type BaseDescuadre = 'VES' | 'USD' | 'ORIGEN';

export interface Descuadre {
  readonly base: BaseDescuadre;
  /** Para ORIGEN: la moneda del grupo descuadrado. */
  readonly moneda?: CodigoMoneda;
  readonly debe: string;
  readonly haber: string;
  /** ΣD − ΣC (firmado). */
  readonly diferencia: string;
}

export interface ResultadoCuadre {
  readonly balanceado: boolean;
  readonly descuadres: ReadonlyArray<Descuadre>;
}

function sumaLado(lineas: ReadonlyArray<LineaAsiento>, lado: 'D' | 'C', base: 'VES' | 'USD'): Money {
  const moneda = base === 'VES' ? MONEDA_VES : MONEDA_USD_MGMT;
  return lineas
    .filter((l) => l.dc === lado)
    .reduce((acc, l) => acc.suma(l.montoEnBase(base)), Money.cero(moneda));
}

function descuadreDeBase(
  lineas: ReadonlyArray<LineaAsiento>,
  base: 'VES' | 'USD',
): Descuadre | null {
  const debe = sumaLado(lineas, 'D', base);
  const haber = sumaLado(lineas, 'C', base);
  if (debe.igualA(haber)) return null;
  return {
    base,
    debe: debe.aCadenaDecimal(),
    haber: haber.aCadenaDecimal(),
    diferencia: debe.resta(haber).aCadenaDecimal(),
  };
}

function descuadresPorOrigen(lineas: ReadonlyArray<LineaAsiento>): Descuadre[] {
  // Solo líneas operativas (las de ajuste se excluyen del cuadre por moneda origen).
  const operativas = lineas.filter((l) => !l.esAjuste);
  const monedas = new Set<CodigoMoneda>(operativas.map((l) => l.moneda));
  const descuadres: Descuadre[] = [];

  for (const moneda of monedas) {
    const delGrupo = operativas.filter((l) => l.moneda === moneda);
    const debe = delGrupo
      .filter((l) => l.dc === 'D')
      .reduce((acc, l) => acc.suma(l.montoOrigen), Money.cero(moneda));
    const haber = delGrupo
      .filter((l) => l.dc === 'C')
      .reduce((acc, l) => acc.suma(l.montoOrigen), Money.cero(moneda));
    if (!debe.igualA(haber)) {
      descuadres.push({
        base: 'ORIGEN',
        moneda,
        debe: debe.aCadenaDecimal(),
        haber: haber.aCadenaDecimal(),
        diferencia: debe.resta(haber).aCadenaDecimal(),
      });
    }
  }
  return descuadres;
}

/** Verifica el cuadre triple base sin lanzar. Útil para property tests y para la UI. */
export function verificarCuadre(lineas: ReadonlyArray<LineaAsiento>): ResultadoCuadre {
  const descuadres: Descuadre[] = [];
  const ves = descuadreDeBase(lineas, 'VES');
  if (ves) descuadres.push(ves);
  const usd = descuadreDeBase(lineas, 'USD');
  if (usd) descuadres.push(usd);
  descuadres.push(...descuadresPorOrigen(lineas));
  return { balanceado: descuadres.length === 0, descuadres };
}

/** Error de asiento desbalanceado, con el detalle de cada base/moneda descuadrada. */
export class AsientoDesbalanceadoError extends Error {
  readonly descuadres: ReadonlyArray<Descuadre>;
  constructor(descuadres: ReadonlyArray<Descuadre>) {
    const detalle = descuadres
      .map((d) => `${d.base}${d.moneda ? `(${d.moneda})` : ''}: ΣD−ΣC=${d.diferencia}`)
      .join('; ');
    super(`Asiento desbalanceado (ΣD≠ΣC): ${detalle}`);
    this.name = 'AsientoDesbalanceadoError';
    this.descuadres = descuadres;
  }
}
