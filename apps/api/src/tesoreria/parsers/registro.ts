import { parserBanescoV1 } from './banesco';
import { parserMercantilV1 } from './mercantil';
import type { EstadoParseado, ParserBanco } from './tipos';

/**
 * Registro de parsers de banco (P11, docs/05 §5 F1). El importador detecta el formato del archivo y
 * elige el parser. Se empieza por **Banesco** y **Mercantil** (instrucción P11); el resto (BNC,
 * Provincial, BDV) se añade aquí sin tocar el importador. Los parsers están **versionados**: convive
 * más de una versión por banco cuando cambian el formato.
 */
export const PARSERS: ReadonlyArray<ParserBanco> = [parserBanescoV1, parserMercantilV1];

/** Parser cuyo `version` coincide exactamente (para re-procesar con una versión fija). */
export function parserPorVersion(version: string): ParserBanco | undefined {
  return PARSERS.find((p) => p.version === version);
}

/**
 * Elige el parser por banco esperado + autodetección. Si `bancoEsperado` se indica, restringe a los
 * parsers de ese banco; entre ellos (y si no) usa `detecta()`.
 */
export function elegirParser(contenido: string, nombreArchivo: string, bancoEsperado?: string): ParserBanco | undefined {
  const candidatos = bancoEsperado ? PARSERS.filter((p) => p.banco === bancoEsperado) : PARSERS;
  return candidatos.find((p) => p.detecta(contenido, nombreArchivo)) ?? (bancoEsperado ? candidatos[0] : undefined);
}

/** Parsea el contenido eligiendo el parser; lanza si ninguno reconoce el formato. */
export function parsearEstado(contenido: string, nombreArchivo: string, bancoEsperado?: string): EstadoParseado {
  const parser = elegirParser(contenido, nombreArchivo, bancoEsperado);
  if (parser === undefined) {
    throw new Error(`No se reconoció el formato del extracto "${nombreArchivo}"${bancoEsperado ? ` (banco ${bancoEsperado})` : ''}`);
  }
  return parser.parse(contenido);
}
