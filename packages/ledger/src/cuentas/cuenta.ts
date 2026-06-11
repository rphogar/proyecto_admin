import type { CodigoMoneda } from '@contave/shared';
import { claseDeCodigo, codigoPadre, nivelDeCodigo } from './codigo';
import { naturalezaDeClase, type NaturalezaCuenta } from './naturaleza';

/**
 * Definición de una cuenta tal como se siembra/configura (entrada al {@link PlanDeCuentas}).
 * La naturaleza, el nivel y el padre se DERIVAN del código (no se repiten para evitar
 * inconsistencias). `esMovimiento` también se deriva (una cuenta es de movimiento sii es hoja),
 * pero se permite declararla para documentar la intención y validar contra el árbol.
 */
export interface DefinicionCuenta {
  /** Código jerárquico `C.GG.SS.AAA` (docs/03 §2). */
  readonly codigo: string;
  readonly nombre: string;
  /**
   * Moneda funcional de la cuenta cuando es inherentemente en divisa (p.ej. Caja USD,
   * Clientes divisas). Informativa; no restringe la moneda de las líneas. Opcional.
   */
  readonly moneda?: CodigoMoneda;
  /** Cuenta de sistema (parte del catálogo base): no borrable si tiene movimientos (docs/03 §2). */
  readonly esSistema?: boolean;
}

/** Cuenta resuelta dentro de un {@link PlanDeCuentas}: definición + atributos derivados del árbol. */
export interface Cuenta extends DefinicionCuenta {
  readonly naturaleza: NaturalezaCuenta;
  readonly nivel: number;
  readonly codigoPadre: string | null;
  /** Cuenta de movimiento (hoja): puede recibir líneas de asiento. Las superiores totalizan. */
  readonly esMovimiento: boolean;
}

/**
 * Atributos derivables de una cuenta SOLO a partir de su código (sin conocer el árbol).
 * `esMovimiento` no se incluye aquí porque depende de si tiene hijos.
 */
export function atributosDerivados(def: DefinicionCuenta): {
  naturaleza: NaturalezaCuenta;
  nivel: number;
  codigoPadre: string | null;
} {
  return {
    naturaleza: naturalezaDeClase(claseDeCodigo(def.codigo)),
    nivel: nivelDeCodigo(def.codigo),
    codigoPadre: codigoPadre(def.codigo),
  };
}
