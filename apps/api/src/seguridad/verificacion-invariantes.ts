import { Decimal } from '@contave/shared';

/**
 * Verificación de invariantes del sistema (docs/05 §7) para el **drill de backup/restore**
 * (caso 56: tras restaurar en un ambiente limpio, los invariantes del ledger deben cumplirse al
 * 100%). Núcleo PURO: recibe filas ya extraídas de la base restaurada y devuelve las violaciones,
 * de modo que la lógica se prueba sin IO y el drill (int spec / script de ops) solo aporta los datos.
 *
 * Invariantes cubiertos aquí (los derivables de datos):
 *   §7.1  ∀ asiento POSTED: ΣD = ΣC en VES, USD y origen (tolerancia 0).
 *   §7.2  ∀ serie: correlativo sin huecos ni duplicados.
 *   §7.8  ningún saldo es verdad: el ledger global cuadra (ΣD = ΣC) por base.
 */

export interface LineaAsiento {
  entryId: string;
  /** 'D' débito | 'C' crédito. */
  dc: string;
  currency: string;
  amountVes: string;
  amountUsdMgmt: string;
  amountOrigen: string;
}

export interface DocumentoNumerado {
  seriesId: string;
  /** Número asignado (los emitidos lo tienen; los borradores se excluyen antes de llamar). */
  number: number;
}

export interface DatosInvariantes {
  /** Líneas de asientos POSTED (todas las empresas/tenants del backup). */
  lineasAsientos: LineaAsiento[];
  /** Documentos emitidos con número, para el chequeo de correlativo. */
  documentos: DocumentoNumerado[];
}

export interface Violacion {
  invariante: string;
  detalle: string;
}

export interface ReporteInvariantes {
  ok: boolean;
  violaciones: Violacion[];
  /** Métricas de cobertura del drill (para el informe). */
  asientosVerificados: number;
  seriesVerificadas: number;
}

const BASES: { campo: keyof LineaAsiento; nombre: string }[] = [
  { campo: 'amountVes', nombre: 'VES' },
  { campo: 'amountUsdMgmt', nombre: 'USD' },
  { campo: 'amountOrigen', nombre: 'origen' },
];

/** §7.1 — cada asiento POSTED cuadra ΣD = ΣC en las tres bases. */
export function verificarBalanceAsientos(lineas: LineaAsiento[]): {
  violaciones: Violacion[];
  asientos: number;
} {
  const porAsiento = new Map<string, LineaAsiento[]>();
  for (const l of lineas) {
    const arr = porAsiento.get(l.entryId) ?? [];
    arr.push(l);
    porAsiento.set(l.entryId, arr);
  }

  const violaciones: Violacion[] = [];
  for (const [entryId, ls] of porAsiento) {
    for (const base of BASES) {
      let debe = new Decimal(0);
      let haber = new Decimal(0);
      for (const l of ls) {
        const monto = new Decimal(l[base.campo] as string);
        if (l.dc === 'D') debe = debe.plus(monto);
        else haber = haber.plus(monto);
      }
      if (!debe.equals(haber)) {
        violaciones.push({
          invariante: '§7.1 balance del asiento',
          detalle: `asiento ${entryId} descuadra en base ${base.nombre}: D=${debe.toString()} C=${haber.toString()}`,
        });
      }
    }
  }
  return { violaciones, asientos: porAsiento.size };
}

/** §7.2 — correlativo de cada serie sin huecos ni duplicados (asume inicio en 1). */
export function verificarNumeracion(documentos: DocumentoNumerado[]): {
  violaciones: Violacion[];
  series: number;
} {
  const porSerie = new Map<string, number[]>();
  for (const d of documentos) {
    const arr = porSerie.get(d.seriesId) ?? [];
    arr.push(d.number);
    porSerie.set(d.seriesId, arr);
  }

  const violaciones: Violacion[] = [];
  for (const [seriesId, nums] of porSerie) {
    const ordenados = [...nums].sort((a, b) => a - b);
    const vistos = new Set<number>();
    for (let i = 0; i < ordenados.length; i += 1) {
      const n = ordenados[i]!;
      if (vistos.has(n)) {
        violaciones.push({
          invariante: '§7.2 numeración sin duplicados',
          detalle: `serie ${seriesId}: número ${n} duplicado`,
        });
      }
      vistos.add(n);
      const esperado = i + 1;
      if (n !== esperado) {
        violaciones.push({
          invariante: '§7.2 numeración sin huecos',
          detalle: `serie ${seriesId}: se esperaba ${esperado} y apareció ${n}`,
        });
        break; // un hueco basta; evita ruido en cascada
      }
    }
  }
  return { violaciones, series: porSerie.size };
}

/** §7.8 — el ledger global cuadra ΣD = ΣC por base (los saldos se derivan, no se almacenan). */
export function verificarCuadreGlobal(lineas: LineaAsiento[]): Violacion[] {
  const violaciones: Violacion[] = [];
  for (const base of BASES) {
    let debe = new Decimal(0);
    let haber = new Decimal(0);
    for (const l of lineas) {
      const monto = new Decimal(l[base.campo] as string);
      if (l.dc === 'D') debe = debe.plus(monto);
      else haber = haber.plus(monto);
    }
    if (!debe.equals(haber)) {
      violaciones.push({
        invariante: '§7.8 cuadre global del ledger',
        detalle: `el mayor global descuadra en base ${base.nombre}: D=${debe.toString()} C=${haber.toString()}`,
      });
    }
  }
  return violaciones;
}

/** Ejecuta todos los chequeos y arma el reporte del drill. */
export function verificarInvariantes(datos: DatosInvariantes): ReporteInvariantes {
  const balance = verificarBalanceAsientos(datos.lineasAsientos);
  const numeracion = verificarNumeracion(datos.documentos);
  const global = verificarCuadreGlobal(datos.lineasAsientos);

  const violaciones = [...balance.violaciones, ...numeracion.violaciones, ...global];
  return {
    ok: violaciones.length === 0,
    violaciones,
    asientosVerificados: balance.asientos,
    seriesVerificadas: numeracion.series,
  };
}
