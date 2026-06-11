import { atributosDerivados, type Cuenta, type DefinicionCuenta } from './cuenta';
import { codigoPadre } from './codigo';
import type { NaturalezaCuenta } from './naturaleza';

/**
 * Plan de cuentas: árbol de cuentas con validaciones contables (docs/03 §2).
 *
 * Invariantes que garantiza al construirse (lanza si se violan):
 * - Códigos únicos.
 * - Toda cuenta no-raíz tiene su padre presente en el plan.
 * - La clase (1–6) es válida (vía naturaleza derivada del código).
 * - "Cuentas de movimiento solo en el último nivel": una cuenta es de MOVIMIENTO sii es hoja
 *   (no tiene hijas); las superiores son totalizadoras. Las líneas de asiento solo pueden
 *   imputarse a cuentas de movimiento (lo valida el motor de asientos/posting).
 *
 * Es inmutable: una vez construido, el árbol no cambia.
 */
export class PlanDeCuentas {
  private readonly porCodigo: ReadonlyMap<string, Cuenta>;
  private readonly hijosPorCodigo: ReadonlyMap<string, string[]>;

  private constructor(
    porCodigo: ReadonlyMap<string, Cuenta>,
    hijosPorCodigo: ReadonlyMap<string, string[]>,
  ) {
    this.porCodigo = porCodigo;
    this.hijosPorCodigo = hijosPorCodigo;
  }

  /** Construye y valida un plan a partir de definiciones planas. */
  static desde(definiciones: ReadonlyArray<DefinicionCuenta>): PlanDeCuentas {
    if (definiciones.length === 0) {
      throw new Error('El plan de cuentas no puede estar vacío');
    }

    const hijos = new Map<string, string[]>();
    const codigos = new Set<string>();

    // 1) Unicidad de códigos + índice de hijos por padre.
    for (const def of definiciones) {
      // atributosDerivados valida de paso la forma del código y la clase (1–6).
      atributosDerivados(def);
      if (codigos.has(def.codigo)) {
        throw new Error(`Código de cuenta duplicado en el plan: "${def.codigo}"`);
      }
      codigos.add(def.codigo);
    }

    for (const def of definiciones) {
      const padre = codigoPadre(def.codigo);
      if (padre !== null) {
        if (!codigos.has(padre)) {
          throw new Error(
            `La cuenta "${def.codigo}" referencia un padre inexistente "${padre}" en el plan`,
          );
        }
        const lista = hijos.get(padre) ?? [];
        lista.push(def.codigo);
        hijos.set(padre, lista);
      }
    }

    // 2) Resolver cada cuenta con esMovimiento = es hoja (sin hijas).
    const porCodigo = new Map<string, Cuenta>();
    for (const def of definiciones) {
      const derivados = atributosDerivados(def);
      const esMovimiento = (hijos.get(def.codigo)?.length ?? 0) === 0;
      porCodigo.set(def.codigo, {
        ...def,
        ...derivados,
        esMovimiento,
      });
    }

    return new PlanDeCuentas(porCodigo, hijos);
  }

  /** Cuenta por código, o `undefined` si no existe. */
  cuenta(codigo: string): Cuenta | undefined {
    return this.porCodigo.get(codigo);
  }

  /** Cuenta por código; lanza si no existe (uso en validaciones de imputación). */
  requerirCuenta(codigo: string): Cuenta {
    const cuenta = this.porCodigo.get(codigo);
    if (cuenta === undefined) {
      throw new Error(`Cuenta inexistente en el plan: "${codigo}"`);
    }
    return cuenta;
  }

  /** True si la cuenta existe y es de movimiento (hoja). */
  esMovimiento(codigo: string): boolean {
    return this.porCodigo.get(codigo)?.esMovimiento ?? false;
  }

  /** Naturaleza de una cuenta existente; lanza si no existe. */
  naturalezaDe(codigo: string): NaturalezaCuenta {
    return this.requerirCuenta(codigo).naturaleza;
  }

  /** Hijas directas (en el orden en que se definieron). */
  hijos(codigo: string): Cuenta[] {
    return (this.hijosPorCodigo.get(codigo) ?? []).map((c) => this.porCodigo.get(c)!);
  }

  /** Cuentas raíz (clases 1–6). */
  raices(): Cuenta[] {
    return [...this.porCodigo.values()].filter((c) => c.codigoPadre === null);
  }

  /** Todas las cuentas de movimiento (hojas). */
  cuentasDeMovimiento(): Cuenta[] {
    return [...this.porCodigo.values()].filter((c) => c.esMovimiento);
  }

  /** Todas las cuentas del plan. */
  todas(): Cuenta[] {
    return [...this.porCodigo.values()];
  }

  /** Cantidad de cuentas. */
  get tamano(): number {
    return this.porCodigo.size;
  }
}
