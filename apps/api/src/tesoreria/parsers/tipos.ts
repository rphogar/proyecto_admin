/**
 * Tipos de los parsers de estados de cuenta bancarios (P11, docs/05 §5 integración F1, docs/06 M4).
 * Cada banco exporta su extracto con un formato propio que CAMBIA con el tiempo → parsers
 * **versionados**: `version` viaja a `bank_statements.parser_version` para trazar con qué lógica se
 * importó cada estado. El parser es PURO (texto → líneas); la persistencia, el hash y la idempotencia
 * viven en el importador.
 */

/** Una línea (movimiento) cruda del extracto, ya normalizada. */
export interface LineaEstadoCruda {
  /** Fecha civil `YYYY-MM-DD`. */
  readonly fecha: string;
  readonly descripcion: string;
  readonly referencia: string | null;
  /** Monto firmado como Decimal-string (+ abono / − cargo). */
  readonly monto: string;
  readonly moneda: string;
  /** Saldo informado por el banco tras el movimiento (Decimal-string) o null. */
  readonly saldo: string | null;
}

/** Resultado de parsear un extracto completo. */
export interface EstadoParseado {
  readonly banco: string;
  readonly parserVersion: string;
  readonly lineas: LineaEstadoCruda[];
  readonly saldoInicial: string | null;
  readonly saldoFinal: string | null;
  readonly desde: string | null;
  readonly hasta: string | null;
}

/** Contrato de un parser de banco. */
export interface ParserBanco {
  readonly banco: string;
  readonly version: string;
  /** True si este parser reconoce el contenido/nombre de archivo. */
  detecta(contenido: string, nombreArchivo: string): boolean;
  /** Parsea el contenido a líneas normalizadas. Lanza Error si el formato no calza. */
  parse(contenido: string): EstadoParseado;
}

/** Líneas no vacías del contenido (tolerante a CRLF y BOM). */
export function lineasDe(contenido: string): string[] {
  return contenido
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** `dd/mm/yyyy` o `dd-mm-yyyy` → `yyyy-mm-dd`. Lanza si no calza. */
export function fechaISO(dmy: string): string {
  const m = dmy.trim().match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m === null) throw new Error(`Fecha inválida en el extracto: "${dmy}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}
