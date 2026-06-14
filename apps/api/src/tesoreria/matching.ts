import { Decimal } from '@contave/shared';

/**
 * Motor PURO de conciliación bancaria (docs/06 M4, "feature estrella"). Sin IO: 100% testeable.
 * Empareja líneas del extracto del banco con movimientos del sistema (asientos sobre la cuenta del
 * banco) por **monto + fecha + referencia**, con un **score** 0–100 y tolerancia configurable.
 * Produce sugerencias **1:1**, **1:n** (un movimiento de banco = suma de n del sistema) y **n:1**.
 *
 * Convención de signo: `monto` firmado, + entra dinero al banco (abono) / − sale (cargo). Un
 * movimiento del sistema es un asiento sobre la cuenta del banco: débito (entra) = +, crédito = −.
 * Sólo se emparejan montos del MISMO signo. La asignación es **greedy** por score descendente (cada
 * línea se usa una vez), primero 1:1 y luego los agrupamientos por subset-sum acotado.
 */

/** Línea del extracto bancario candidata a conciliar. */
export interface MovBanco {
  readonly id: string;
  /** Fecha civil `YYYY-MM-DD`. */
  readonly fecha: string;
  /** Monto firmado (+ abono / − cargo). */
  readonly monto: string;
  readonly referencia?: string | null;
}

/** Movimiento del sistema (línea de asiento sobre la cuenta del banco). */
export interface MovSistema {
  readonly id: string;
  readonly fecha: string;
  /** Monto firmado (+ débito a la cuenta del banco / − crédito). */
  readonly monto: string;
  readonly referencia?: string | null;
}

export interface OpcionesMatching {
  /** Tolerancia absoluta de monto (céntimos de tasa); default 0.02. */
  readonly toleranciaMonto?: string;
  /** Ventana de días para considerar candidatos; default 5. */
  readonly ventanaDias?: number;
  /** Cardinalidad máxima del lado agrupado en 1:n / n:1; default 4. */
  readonly cardinalidadMax?: number;
  /** Score mínimo para sugerir (0–100); default 50. */
  readonly scoreMinimo?: number;
}

export type TipoMatch = 'UNO_A_UNO' | 'UNO_A_N' | 'N_A_UNO';

export interface Sugerencia {
  readonly tipo: TipoMatch;
  /** Confianza 0–100. */
  readonly score: number;
  readonly bancoIds: ReadonlyArray<string>;
  readonly sistemaIds: ReadonlyArray<string>;
}

const PESO_MONTO = 60;
const PESO_FECHA = 25;
const PESO_REF = 15;

interface Cfg {
  tol: Decimal;
  ventana: number;
  cardinalidad: number;
  scoreMin: number;
}

function cfg(o: OpcionesMatching = {}): Cfg {
  return {
    tol: new Decimal(o.toleranciaMonto ?? '0.02'),
    ventana: o.ventanaDias ?? 5,
    cardinalidad: o.cardinalidadMax ?? 4,
    scoreMin: o.scoreMinimo ?? 50,
  };
}

function dias(a: string, b: string): number {
  const ms = Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime());
  return Math.round(ms / 86_400_000);
}

/** Dígitos significativos de una referencia (las referencias bancarias suelen ser numéricas). */
function digitos(ref: string | null | undefined): string {
  return (ref ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Similitud de referencias 0–1: igualdad/contención de la cola numérica o substring largo común. */
function similitudRef(a: string | null | undefined, b: string | null | undefined): number {
  const da = digitos(a);
  const db = digitos(b);
  if (da === '' || db === '') return 0;
  if (da === db) return 1;
  if (da.endsWith(db) || db.endsWith(da)) return 0.9;
  if (da.includes(db) || db.includes(da)) return 0.7;
  const min = Math.min(da.length, db.length);
  for (let len = min; len >= 4; len--) {
    for (let i = 0; i + len <= da.length; i++) {
      if (db.includes(da.slice(i, i + len))) return 0.5;
    }
  }
  return 0;
}

/** Score de monto 0–1: 1 si coincide exacto, decae hasta 0,5 en el borde de la tolerancia (dentro
 * de tolerancia los montos "coinciden": no debe anular el match, solo matizarlo). */
function scoreMonto(diff: Decimal, tol: Decimal): number {
  if (diff.gt(tol)) return 0;
  if (tol.lte(0)) return diff.isZero() ? 1 : 0;
  return new Decimal(1).minus(diff.div(tol).times('0.5')).toNumber();
}

function scoreFecha(d: number, ventana: number): number {
  if (d > ventana) return 0;
  if (ventana <= 0) return d === 0 ? 1 : 0;
  return 1 - d / ventana;
}

function scorePar(b: MovBanco, s: MovSistema, c: Cfg): number {
  const diff = new Decimal(b.monto).minus(s.monto).abs();
  if (diff.gt(c.tol)) return 0;
  const d = dias(b.fecha, s.fecha);
  if (d > c.ventana) return 0;
  return PESO_MONTO * scoreMonto(diff, c.tol) + PESO_FECHA * scoreFecha(d, c.ventana) + PESO_REF * similitudRef(b.referencia, s.referencia);
}

function mismoSigno(a: string, b: string): boolean {
  const x = new Decimal(a);
  const y = new Decimal(b);
  return x.isPositive() === y.isPositive();
}

/** Subconjuntos de `items` (de tamaño ≤ max) cuya suma de monto ≈ `objetivo` dentro de tolerancia. */
function subsetsQueSuman(
  items: ReadonlyArray<{ id: string; monto: Decimal; fecha: string }>,
  objetivo: Decimal,
  tol: Decimal,
  max: number,
): string[] | null {
  let mejor: string[] | null = null;
  const buscar = (desde: number, elegidos: { id: string; monto: Decimal }[], suma: Decimal): void => {
    if (elegidos.length >= 2 && suma.minus(objetivo).abs().lte(tol)) {
      if (mejor === null || elegidos.length < mejor.length) mejor = elegidos.map((e) => e.id);
      return;
    }
    if (elegidos.length >= max) return;
    for (let i = desde; i < items.length; i++) {
      const it = items[i];
      if (it === undefined) continue;
      buscar(i + 1, [...elegidos, { id: it.id, monto: it.monto }], suma.plus(it.monto));
    }
  };
  buscar(0, [], new Decimal(0));
  return mejor;
}

/**
 * Sugerencias de conciliación ordenadas por score descendente. Asignación greedy: cada línea de
 * banco y de sistema se usa a lo sumo una vez. Primero 1:1, luego 1:n y n:1 sobre lo que queda.
 */
export function sugerirConciliaciones(
  banco: ReadonlyArray<MovBanco>,
  sistema: ReadonlyArray<MovSistema>,
  opciones: OpcionesMatching = {},
): Sugerencia[] {
  const c = cfg(opciones);
  const usadosBanco = new Set<string>();
  const usadosSistema = new Set<string>();
  const sugerencias: Sugerencia[] = [];

  // 1) Pares 1:1 candidatos, ordenados por score desc; greedy.
  const pares: { score: number; b: string; s: string }[] = [];
  for (const b of banco) {
    for (const s of sistema) {
      if (!mismoSigno(b.monto, s.monto)) continue;
      const sc = scorePar(b, s, c);
      if (sc >= c.scoreMin) pares.push({ score: sc, b: b.id, s: s.id });
    }
  }
  pares.sort((x, y) => y.score - x.score);
  for (const p of pares) {
    if (usadosBanco.has(p.b) || usadosSistema.has(p.s)) continue;
    usadosBanco.add(p.b);
    usadosSistema.add(p.s);
    sugerencias.push({ tipo: 'UNO_A_UNO', score: Math.round(p.score * 100) / 100, bancoIds: [p.b], sistemaIds: [p.s] });
  }

  // 2) 1:n — una línea de banco = suma de n del sistema (dentro de la ventana, mismo signo).
  for (const b of banco) {
    if (usadosBanco.has(b.id)) continue;
    const objetivo = new Decimal(b.monto);
    const candidatos = sistema
      .filter((s) => !usadosSistema.has(s.id) && mismoSigno(s.monto, b.monto) && dias(b.fecha, s.fecha) <= c.ventana)
      .map((s) => ({ id: s.id, monto: new Decimal(s.monto), fecha: s.fecha }));
    const subset = subsetsQueSuman(candidatos, objetivo, c.tol, c.cardinalidad);
    if (subset && subset.length >= 2) {
      usadosBanco.add(b.id);
      subset.forEach((id) => usadosSistema.add(id));
      sugerencias.push({ tipo: 'UNO_A_N', score: PESO_MONTO + PESO_FECHA, bancoIds: [b.id], sistemaIds: subset });
    }
  }

  // 3) n:1 — una línea de sistema = suma de n del banco.
  for (const s of sistema) {
    if (usadosSistema.has(s.id)) continue;
    const objetivo = new Decimal(s.monto);
    const candidatos = banco
      .filter((b) => !usadosBanco.has(b.id) && mismoSigno(b.monto, s.monto) && dias(s.fecha, b.fecha) <= c.ventana)
      .map((b) => ({ id: b.id, monto: new Decimal(b.monto), fecha: b.fecha }));
    const subset = subsetsQueSuman(candidatos, objetivo, c.tol, c.cardinalidad);
    if (subset && subset.length >= 2) {
      usadosSistema.add(s.id);
      subset.forEach((id) => usadosBanco.add(id));
      sugerencias.push({ tipo: 'N_A_UNO', score: PESO_MONTO + PESO_FECHA, bancoIds: subset, sistemaIds: [s.id] });
    }
  }

  return sugerencias;
}
