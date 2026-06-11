// Naturaleza de las cuentas y su saldo normal (docs/03 §1, tabla de naturalezas).
// Define qué lado (débito/crédito) AUMENTA cada tipo de cuenta y, por tanto, su saldo normal.

/** Lado de la partida doble: Débito o Crédito. */
export type Lado = 'D' | 'C';

/**
 * Tipo/naturaleza de una cuenta del plan. Se deriva de la CLASE (primer dígito del código):
 * 1=ACTIVO, 2=PASIVO, 3=PATRIMONIO, 4=INGRESO, 5=COSTO, 6=GASTO (docs/03 §2).
 */
export type NaturalezaCuenta =
  | 'ACTIVO'
  | 'PASIVO'
  | 'PATRIMONIO'
  | 'INGRESO'
  | 'COSTO'
  | 'GASTO';

/** Clases del plan (primer segmento del código) → naturaleza (docs/03 §2). */
const NATURALEZA_POR_CLASE: Readonly<Record<number, NaturalezaCuenta>> = {
  1: 'ACTIVO',
  2: 'PASIVO',
  3: 'PATRIMONIO',
  4: 'INGRESO',
  5: 'COSTO',
  6: 'GASTO',
};

/** Cuentas cuyo saldo normal y aumento es por DÉBITO (saldo deudor). El resto, por crédito. */
const AUMENTAN_POR_DEBITO: ReadonlySet<NaturalezaCuenta> = new Set<NaturalezaCuenta>([
  'ACTIVO',
  'COSTO',
  'GASTO',
]);

/** Naturaleza correspondiente a una clase (1–6). Lanza si la clase no es válida. */
export function naturalezaDeClase(clase: number): NaturalezaCuenta {
  const naturaleza = NATURALEZA_POR_CLASE[clase];
  if (naturaleza === undefined) {
    throw new Error(`Clase de cuenta inválida: ${clase} (debe ser 1–6)`);
  }
  return naturaleza;
}

/**
 * Lado que AUMENTA una cuenta de la naturaleza dada (docs/03 §1):
 * Activo/Costo/Gasto → Débito; Pasivo/Patrimonio/Ingreso → Crédito.
 */
export function ladoQueAumenta(naturaleza: NaturalezaCuenta): Lado {
  return AUMENTAN_POR_DEBITO.has(naturaleza) ? 'D' : 'C';
}

/** Lado que DISMINUYE una cuenta (el opuesto a {@link ladoQueAumenta}). */
export function ladoQueDisminuye(naturaleza: NaturalezaCuenta): Lado {
  return ladoQueAumenta(naturaleza) === 'D' ? 'C' : 'D';
}

/** Saldo normal de la cuenta: 'D' (deudor) o 'C' (acreedor). Coincide con el lado que la aumenta. */
export function saldoNormal(naturaleza: NaturalezaCuenta): Lado {
  return ladoQueAumenta(naturaleza);
}

/** Lado opuesto. Útil para reversos (se invierte D↔C). */
export function ladoOpuesto(lado: Lado): Lado {
  return lado === 'D' ? 'C' : 'D';
}
