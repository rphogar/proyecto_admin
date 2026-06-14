import { Decimal } from '@contave/shared';
import { type EstadoParseado, fechaISO, lineasDe, type LineaEstadoCruda, type ParserBanco } from './tipos';

/**
 * Parser del estado de cuenta de **Banesco** (P11, integración F1). Formato observado del export web:
 * CSV con separador `;`, fechas `dd/mm/yyyy`, montos en formato es-VE (punto de miles, coma decimal)
 * y columnas separadas de **Cargo** y **Abono** + Saldo. El monto se normaliza firmado: + Abono
 * (entra) / − Cargo (sale).
 *
 *   Fecha;Referencia;Descripción;Cargo;Abono;Saldo
 *   15/05/2026;000123456;PAGO MOVIL RECIBIDO;;1.500,00;25.300,50
 *   16/05/2026;000123457;COMPRA POS COMERCIO;850,00;;24.450,50
 *
 * Versión `banesco-v1`. Si Banesco cambia el formato → nuevo parser versionado (las importaciones
 * previas conservan su `parser_version`).
 */

const SEP = ';';

/** Monto es-VE "1.500,00" → Decimal-string "1500.00". Vacío → null. */
function montoVE(s: string): string | null {
  const limpio = s.trim();
  if (limpio === '') return null;
  const normal = limpio.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (normal === '' || normal === '-') return null;
  return new Decimal(normal).toFixed();
}

export const parserBanescoV1: ParserBanco = {
  banco: 'BANESCO',
  version: 'banesco-v1',

  detecta(contenido: string, nombreArchivo: string): boolean {
    const cabecera = (lineasDe(contenido)[0] ?? '').toLowerCase();
    const pareceBanesco =
      cabecera.includes(SEP) && cabecera.includes('cargo') && cabecera.includes('abono') && cabecera.includes('fecha');
    return pareceBanesco || /banesco/i.test(nombreArchivo);
  },

  parse(contenido: string): EstadoParseado {
    const filas = lineasDe(contenido);
    if (filas.length === 0) throw new Error('Extracto Banesco vacío');
    const [, ...cuerpo] = filas; // descarta la cabecera
    const lineas: LineaEstadoCruda[] = [];

    for (const fila of cuerpo) {
      const col = fila.split(SEP);
      if (col.length < 6) continue;
      const [fecha, referencia, descripcion, cargo, abono, saldo] = col;
      const montoAbono = montoVE(abono ?? '');
      const montoCargo = montoVE(cargo ?? '');
      // Una fila tiene Cargo XOR Abono. Cargo sale (−), Abono entra (+).
      const monto = montoAbono !== null ? montoAbono : montoCargo !== null ? new Decimal(montoCargo).negated().toFixed() : null;
      if (monto === null) continue;
      lineas.push({
        fecha: fechaISO(fecha ?? ''),
        descripcion: (descripcion ?? '').trim(),
        referencia: (referencia ?? '').trim() === '' ? null : (referencia ?? '').trim(),
        monto,
        moneda: 'VES',
        saldo: montoVE(saldo ?? ''),
      });
    }

    return {
      banco: 'BANESCO',
      parserVersion: 'banesco-v1',
      lineas,
      saldoInicial: null,
      saldoFinal: lineas.length > 0 ? (lineas[lineas.length - 1]?.saldo ?? null) : null,
      desde: lineas.length > 0 ? (lineas[0]?.fecha ?? null) : null,
      hasta: lineas.length > 0 ? (lineas[lineas.length - 1]?.fecha ?? null) : null,
    };
  },
};
