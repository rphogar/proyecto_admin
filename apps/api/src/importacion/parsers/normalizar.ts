import { Decimal } from '@contave/shared';

/**
 * Normalización PURA de los valores crudos de los importadores de migración (P31, docs/02 §9, caso 46).
 * Convierte montos en formatos heterogéneos (es-VE "1.234.567,89" o en-US "1234567.89"), fechas
 * (dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd) y booleanos textuales a la forma canónica del sistema, y aplica
 * la **reconversión monetaria histórica** (caso 46): datos de sistemas viejos pueden venir en una
 * escala con más ceros (Bs.F 2008, Bs.S 2018) → se normalizan a la escala VIGENTE (Bs.D / VED 2021).
 */

/**
 * Escalas monetarias históricas de Venezuela y su factor de división para llevar a la escala VIGENTE
 * (Bs.D, VED, reconversión 2021). El sistema SOLO opera en la escala vigente (caso 46); los
 * importadores normalizan al cargar.
 *
 * TODO-TRIBUTARISTA: confirmar los factores exactos y la fecha de corte de cada reconversión antes de
 * producción. Reconversiones: 2008 Bs->Bs.F (/1.000), 2018 Bs.F->Bs.S (/100.000), 2021 Bs.S->Bs.D
 * (/1.000.000). Acumulados a Bs.D: Bs.S = /1e6, Bs.F = /1e11, Bs original = /1e14.
 */
export const ESCALAS_MONETARIAS = {
  /** Bs.D (VED), escala vigente desde 2021: sin reconversión. */
  ACTUAL: '1',
  /** Bs.S (VES 2018): dividir entre 1.000.000 para llegar a Bs.D. */
  BS_S_2018: '1000000',
  /** Bs.F (VEF 2008): dividir entre 1e11 para llegar a Bs.D. */
  BS_F_2008: '100000000000',
  /** Bolívar original (pre-2008): dividir entre 1e14 para llegar a Bs.D. */
  BS_ORIGINAL: '100000000000000',
} as const;

export type EscalaMonetaria = keyof typeof ESCALAS_MONETARIAS;

/** Factor de reconversión de una escala (Decimal-string); `'1'` para escala desconocida/vigente. */
export function factorEscala(escala: EscalaMonetaria | undefined): Decimal {
  if (escala === undefined) return new Decimal(1);
  return new Decimal(ESCALAS_MONETARIAS[escala] ?? '1');
}

/**
 * Aplica la reconversión monetaria histórica a un monto en Bs (caso 46): `monto / factor`. Solo debe
 * aplicarse a montos en VES (las divisas no se redenominaron). Mantiene precisión Decimal completa
 * (regla 1); el redondeo a 2 decimales ocurre aguas abajo, en el asiento.
 */
export function reescalarVes(monto: Decimal, escala: EscalaMonetaria | undefined): Decimal {
  const f = factorEscala(escala);
  return f.equals(1) ? monto : monto.div(f);
}

/**
 * Parsea un monto en texto a Decimal-string canónico (`.` decimal, sin separador de miles). Detecta el
 * formato es-VE ("1.234.567,89", coma decimal) vs en-US ("1,234,567.89" / "1234567.89"). Soporta signo
 * y paréntesis contables `(123,45)` = negativo. Devuelve `null` si está vacío o no es numérico.
 */
export function parsearMonto(texto: string): string | null {
  let s = texto.trim();
  if (s === '') return null;

  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negativo = true;
    s = s.slice(1).trim();
  }
  if (s.startsWith('+')) s = s.slice(1).trim();

  // Quita símbolos de moneda y espacios; deja dígitos y separadores.
  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return null;

  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  let normal: string;
  if (tieneComa && tienePunto) {
    // El último separador que aparece es el decimal; el otro es de miles.
    normal = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (tieneComa) {
    // Solo coma: en es-VE la coma es decimal cuando hay 1-2 dígitos tras ella; si no, son miles.
    const trasComa = s.length - s.lastIndexOf(',') - 1;
    normal = trasComa > 0 && trasComa <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else {
    normal = s;
  }

  let d: Decimal;
  try {
    d = new Decimal(normal);
  } catch {
    return null;
  }
  if (!d.isFinite()) return null;
  return (negativo ? d.negated() : d).toFixed();
}

/**
 * Normaliza una fecha civil a `YYYY-MM-DD`. Acepta `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`,
 * `yyyy/mm/dd` y años de 2 dígitos (20xx). Devuelve `null` si no calza o la fecha es imposible.
 */
export function parsearFecha(texto: string): string | null {
  const s = texto.trim();
  if (s === '') return null;

  let anio: number;
  let mes: number;
  let dia: number;
  const iso = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (iso !== null) {
    anio = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else if (dmy !== null) {
    dia = Number(dmy[1]);
    mes = Number(dmy[2]);
    anio = Number(dmy[3]);
    if (anio < 100) anio += 2000;
  } else {
    return null;
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return `${anio}-${mm}-${dd}`;
}

/** Interpreta un booleano textual: si/sí/true/1/x/y → true; no/false/0/'' → false; null si ambiguo. */
export function parsearBooleano(texto: string): boolean | null {
  const s = texto.trim().toLowerCase();
  if (s === '') return false;
  if (['si', 'sí', 'true', '1', 'x', 'y', 'yes', 'verdadero'].includes(s)) return true;
  if (['no', 'false', '0', 'n', 'falso'].includes(s)) return false;
  return null;
}
