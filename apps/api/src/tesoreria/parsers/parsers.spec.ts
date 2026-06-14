import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parserBanescoV1 } from './banesco';
import { parserMercantilV1 } from './mercantil';
import { elegirParser, parsearEstado, parserPorVersion } from './registro';

const BANESCO = readFileSync(resolve(__dirname, '__fixtures__/banesco-movimientos.csv'), 'utf8');
const MERCANTIL = readFileSync(resolve(__dirname, '__fixtures__/mercantil-movimientos.csv'), 'utf8');

describe('parserBanescoV1', () => {
  it('parsea cargos (−) y abonos (+) con formato es-VE', () => {
    const e = parserBanescoV1.parse(BANESCO);
    expect(e.banco).toBe('BANESCO');
    expect(e.parserVersion).toBe('banesco-v1');
    expect(e.lineas).toHaveLength(6);
    expect(e.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: '1500', referencia: '000456789' });
    // COMPRA POS es un cargo → negativo.
    expect(e.lineas[1]?.monto).toBe('-850.75');
    expect(e.lineas[0]?.saldo).toBe('26800.5');
    expect(e.hasta).toBe('2026-05-20');
  });
});

describe('parserMercantilV1', () => {
  it('parsea la columna Monto firmada con fechas dd-mm-yyyy', () => {
    const e = parserMercantilV1.parse(MERCANTIL);
    expect(e.banco).toBe('MERCANTIL');
    expect(e.lineas).toHaveLength(6);
    expect(e.lineas[0]).toMatchObject({ fecha: '2026-05-02', monto: '1500', referencia: '98765001' });
    expect(e.lineas[1]?.monto).toBe('-850.75');
  });
});

describe('registro de parsers', () => {
  it('autodetecta el banco por la cabecera', () => {
    expect(elegirParser(BANESCO, 'estado.csv')?.banco).toBe('BANESCO');
    expect(elegirParser(MERCANTIL, 'estado.csv')?.banco).toBe('MERCANTIL');
  });

  it('parsea eligiendo el parser y respeta la versión pedida', () => {
    expect(parsearEstado(BANESCO, 'x.csv').banco).toBe('BANESCO');
    expect(parserPorVersion('mercantil-v1')?.banco).toBe('MERCANTIL');
    expect(parserPorVersion('inexistente-v9')).toBeUndefined();
  });

  it('los dos extractos representan los mismos movimientos (montos equivalentes)', () => {
    const b = parserBanescoV1.parse(BANESCO).lineas.map((l) => l.monto);
    const m = parserMercantilV1.parse(MERCANTIL).lineas.map((l) => l.monto);
    expect(b).toEqual(m);
  });

  it('lanza si ningún parser reconoce el formato', () => {
    expect(() => parsearEstado('foo|bar|baz\n1|2|3', 'raro.txt')).toThrow(/no se reconoció/i);
  });
});
