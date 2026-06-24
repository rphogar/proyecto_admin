import { parsearCsv } from './csv';
import { parserCxCGalacV1, parserCxCGenericoV1, parserCxPGalacV1, parserCxPGenericoV1 } from './cuentas-abiertas';
import { parserItemsGalacV1, parserItemsGenericoV1 } from './items';
import { parserSaldosGenericoV1 } from './saldos';
import { parserTercerosGalacV1, parserTercerosGenericoV1 } from './terceros';
import type { EntidadImport, ParserImportacion, ResultadoParseo } from './tipos';

/**
 * Registro de parsers de migración (P31, docs/05 §5). El importador detecta el formato y elige el
 * parser por (entidad, sistema). Se empieza por GENERICO (plantilla descargable) + GALAC; añadir Profit
 * u otra versión es agregar la entrada aquí, sin tocar el servicio. Parsers VERSIONADOS: convive más de
 * una versión por sistema cuando cambian el formato (la importación guarda con qué versión se cargó).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PARSERS: ReadonlyArray<ParserImportacion<any>> = [
  parserTercerosGenericoV1,
  parserTercerosGalacV1,
  parserItemsGenericoV1,
  parserItemsGalacV1,
  parserCxCGenericoV1,
  parserCxCGalacV1,
  parserCxPGenericoV1,
  parserCxPGalacV1,
  parserSaldosGenericoV1,
];

/** Parser cuya `version` coincide exactamente (para re-procesar con una versión fija). */
export function parserPorVersion<T>(version: string): ParserImportacion<T> | undefined {
  return PARSERS.find((p) => p.version === version) as ParserImportacion<T> | undefined;
}

/**
 * Elige el parser para una entidad por autodetección de cabeceras + nombre de archivo. Si `sistema` se
 * indica, restringe a los parsers de ese sistema. Entre los candidatos usa `detecta()`; si ninguno
 * detecta pero el sistema/entidad están fijados, cae al primero (la firma de plantilla es estable).
 */
export function elegirParser<T>(
  entidad: EntidadImport,
  cabeceras: string[],
  nombreArchivo: string,
  sistema?: string,
): ParserImportacion<T> | undefined {
  const candidatos = PARSERS.filter((p) => p.entidad === entidad && (sistema === undefined || p.sistema === sistema));
  // Un parser específico (Galac/Profit) que detecte gana sobre el GENERICO, cuya firma es más laxa.
  const especifico = candidatos.find((p) => p.sistema !== 'GENERICO' && p.detecta(cabeceras, nombreArchivo));
  const detectado = especifico ?? candidatos.find((p) => p.detecta(cabeceras, nombreArchivo));
  return (detectado ?? (sistema !== undefined ? candidatos[0] : candidatos.find((p) => p.sistema === 'GENERICO'))) as
    | ParserImportacion<T>
    | undefined;
}

/** Parsea el contenido eligiendo el parser de la entidad; lanza si ninguno reconoce el formato. */
export function parsearMigracion<T>(
  entidad: EntidadImport,
  contenido: string,
  nombreArchivo: string,
  sistema?: string,
): ResultadoParseo<T> {
  const csv = parsearCsv(contenido);
  const parser = elegirParser<T>(entidad, csv.cabeceras, nombreArchivo, sistema);
  if (parser === undefined) {
    throw new Error(`No se reconoció el formato de "${nombreArchivo}" para ${entidad}`);
  }
  return parser.parse(csv);
}
