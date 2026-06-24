import { describe, expect, it } from 'vitest';
import { columnasPlantilla, plantillaCsv, plantillaExcel } from './plantillas';
import { parsearMigracion } from './parsers/registro';
import { mapearTerceros } from './mapeo';
import type { EntidadImport } from './parsers/tipos';
import type { TerceroCrudo } from './parsers/tipos';

const ENTIDADES: EntidadImport[] = ['TERCEROS', 'ITEMS', 'CXC', 'CXP', 'SALDOS'];

describe('plantillas descargables (P31)', () => {
  it('genera CSV con BOM implícito en el flujo y cabeceras de la entidad', () => {
    for (const e of ENTIDADES) {
      const { contenido, filename } = plantillaCsv(e);
      expect(filename.endsWith('.csv')).toBe(true);
      const primera = contenido.split('\r\n')[0] ?? '';
      for (const col of columnasPlantilla(e)) {
        expect(primera.split(';')).toContain(col);
      }
    }
  });

  it('genera Excel SpreadsheetML válido', () => {
    const { buffer, filename } = plantillaExcel('TERCEROS');
    const xml = buffer.toString('utf8');
    expect(filename.endsWith('.xls')).toBe(true);
    expect(xml).toContain('urn:schemas-microsoft-com:office:spreadsheet');
    expect(xml).toContain('razon_social');
  });

  it('la plantilla de TERCEROS se re-parsea y valida (ejemplos correctos)', () => {
    const { contenido } = plantillaCsv('TERCEROS');
    const filas = parsearMigracion<TerceroCrudo>('TERCEROS', contenido, 'plantilla-terceros.csv').filas;
    const r = mapearTerceros(filas);
    expect(r.errores).toHaveLength(0);
    expect(r.aImportar).toBe(2); // las dos filas de ejemplo, RIF válidos
    expect(r.validas.every((v) => v.datos.rifValido)).toBe(true);
  });
});
