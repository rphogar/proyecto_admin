/**
 * Lector CSV PURO para los importadores de migración (P31, docs/05 §5 — patrón de parsers
 * versionados, como los de banca). Sin IO ni dependencias: texto → cabeceras + filas
 * `Record<columna, valor>`. Tolera BOM, CRLF, comillas con separador/comilla embebidos, y
 * **autodetecta el separador** (`;` en exports es-VE de Excel, `,` o tabulador en otros sistemas).
 *
 * El CSV es solo el TRANSPORTE: la normalización de montos/fechas/escala monetaria (caso 46) y la
 * validación viven en `normalizar.ts` y `mapeo.ts`. Excel se exporta como SpreadsheetML (`plantillas.ts`);
 * para importar, el usuario "Guardar como CSV" — el formato común y estable entre Galac/Profit/Excel.
 */

const SEPARADORES_CANDIDATOS = [';', '\t', ',', '|'] as const;

export interface CsvParseado {
  /** Cabeceras normalizadas (recortadas, sin BOM). El orden es el del archivo. */
  readonly cabeceras: string[];
  /** Separador detectado (para trazabilidad). */
  readonly separador: string;
  /** Filas de datos: cada una mapea cabecera->valor (string crudo, ya sin comillas). */
  readonly filas: Array<Record<string, string>>;
}

/** Quita el BOM inicial (U+FEFF) si está presente. */
function sinBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Tokeniza UNA línea CSV respetando comillas dobles (RFC 4180: `""` escapa una comilla). No parte por
 * saltos de línea — eso lo hace el llamador, que ya separó por filas físicas (no soportamos saltos de
 * línea embebidos dentro de comillas, raro en exports administrativos).
 */
function tokenizarLinea(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i += 1;
        } else {
          enComillas = false;
        }
      } else {
        actual += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((s) => s.trim());
}

/** Elige el separador con más ocurrencias en la línea de cabecera (fuera de comillas). */
function detectarSeparador(cabecera: string): string {
  let mejor = SEPARADORES_CANDIDATOS[0] as string;
  let mejorN = -1;
  for (const sep of SEPARADORES_CANDIDATOS) {
    const n = tokenizarLinea(cabecera, sep).length;
    if (n > mejorN) {
      mejorN = n;
      mejor = sep;
    }
  }
  return mejor;
}

/**
 * Parsea un CSV completo. Lanza si no hay cabecera o si está vacío. Las filas totalmente vacías se
 * descartan; las que traen menos columnas que la cabecera rellenan con `''` (export irregular).
 */
export function parsearCsv(contenido: string): CsvParseado {
  const lineas = sinBom(contenido)
    .split(/\r?\n/)
    .filter((l, i) => l.trim().length > 0 || i === 0);
  const primera = (lineas[0] ?? '').trim();
  if (primera.length === 0) {
    throw new Error('El archivo no tiene cabecera (primera fila vacía)');
  }
  const separador = detectarSeparador(primera);
  const cabeceras = tokenizarLinea(primera, separador);

  const filas: Array<Record<string, string>> = [];
  for (let i = 1; i < lineas.length; i += 1) {
    const cruda = lineas[i] ?? '';
    if (cruda.trim().length === 0) continue;
    const valores = tokenizarLinea(cruda, separador);
    const fila: Record<string, string> = {};
    cabeceras.forEach((cab, j) => {
      fila[cab] = valores[j] ?? '';
    });
    filas.push(fila);
  }

  return { cabeceras, separador, filas };
}

/** Cabeceras en minúsculas, sin acentos ni signos, para emparejar sinónimos de columnas robustamente. */
export function claveCabecera(cabecera: string): string {
  return cabecera
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resuelve el valor de una columna por una lista de sinónimos (normalizados con {@link claveCabecera}).
 * Devuelve `''` si ninguna calza. Permite que Galac/Profit/Excel usen nombres distintos para el mismo
 * dato sin tocar el mapeo.
 */
export function columnaPorSinonimos(fila: Record<string, string>, sinonimos: readonly string[]): string {
  const indice = new Map<string, string>();
  for (const [cab, val] of Object.entries(fila)) {
    indice.set(claveCabecera(cab), val);
  }
  for (const s of sinonimos) {
    const v = indice.get(claveCabecera(s));
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return '';
}

/** True si alguna cabecera del archivo calza (normalizada) con alguno de los sinónimos dados. */
export function tieneAlgunaColumna(cabeceras: string[], sinonimos: readonly string[]): boolean {
  const set = new Set(cabeceras.map(claveCabecera));
  return sinonimos.some((s) => set.has(claveCabecera(s)));
}
