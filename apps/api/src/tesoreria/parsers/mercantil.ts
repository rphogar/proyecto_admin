import { Decimal } from '@contave/shared';
import { type EstadoParseado, fechaISO, lineasDe, type LineaEstadoCruda, type ParserBanco } from './tipos';

/**
 * Parser del estado de cuenta de **Mercantil** (P11, integración F1). Formato observado del export:
 * CSV con separador `,`, fechas `dd-mm-yyyy` y una sola columna **Monto** ya firmada (− para cargos),
 * en formato decimal con punto. Columna Saldo opcional.
 *
 *   Fecha,Referencia,Descripcion,Monto,Saldo
 *   15-05-2026,98765432,TRANSFERENCIA RECIBIDA,1500.00,25300.50
 *   16-05-2026,98765433,PAGO TARJETA DE CREDITO,-850.00,24450.50
 *
 * Versión `mercantil-v1`. Si Mercantil cambia el formato → nuevo parser versionado.
 */

const SEP = ',';

function montoUS(s: string): string | null {
  const limpio = s.trim().replace(/[^\d.-]/g, '');
  if (limpio === '' || limpio === '-') return null;
  return new Decimal(limpio).toFixed();
}

export const parserMercantilV1: ParserBanco = {
  banco: 'MERCANTIL',
  version: 'mercantil-v1',

  detecta(contenido: string, nombreArchivo: string): boolean {
    const cabecera = (lineasDe(contenido)[0] ?? '').toLowerCase();
    const pareceMercantil =
      cabecera.includes(SEP) && cabecera.includes('monto') && cabecera.includes('fecha') && !cabecera.includes('cargo');
    return pareceMercantil || /mercantil/i.test(nombreArchivo);
  },

  parse(contenido: string): EstadoParseado {
    const filas = lineasDe(contenido);
    if (filas.length === 0) throw new Error('Extracto Mercantil vacío');
    const [, ...cuerpo] = filas;
    const lineas: LineaEstadoCruda[] = [];

    for (const fila of cuerpo) {
      const col = fila.split(SEP);
      if (col.length < 4) continue;
      const [fecha, referencia, descripcion, monto, saldo] = col;
      const m = montoUS(monto ?? '');
      if (m === null) continue;
      lineas.push({
        fecha: fechaISO(fecha ?? ''),
        descripcion: (descripcion ?? '').trim(),
        referencia: (referencia ?? '').trim() === '' ? null : (referencia ?? '').trim(),
        monto: m,
        moneda: 'VES',
        saldo: montoUS(saldo ?? ''),
      });
    }

    return {
      banco: 'MERCANTIL',
      parserVersion: 'mercantil-v1',
      lineas,
      saldoInicial: null,
      saldoFinal: lineas.length > 0 ? (lineas[lineas.length - 1]?.saldo ?? null) : null,
      desde: lineas.length > 0 ? (lineas[0]?.fecha ?? null) : null,
      hasta: lineas.length > 0 ? (lineas[lineas.length - 1]?.fecha ?? null) : null,
    };
  },
};
