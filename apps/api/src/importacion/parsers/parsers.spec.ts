import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { columnaPorSinonimos, parsearCsv } from './csv';
import { parsearFecha, parsearMonto, reescalarVes } from './normalizar';
import { elegirParser, parsearMigracion, parserPorVersion } from './registro';
import type { CuentaAbiertaCruda, ItemCrudo, SaldoCrudo, TerceroCrudo } from './tipos';

const fx = (n: string): string => readFileSync(resolve(__dirname, '__fixtures__', n), 'utf8');

describe('parsearCsv', () => {
  it('autodetecta el separador `;` y mapea cabecera->valor', () => {
    const csv = parsearCsv('a;b;c\n1;2;3\n');
    expect(csv.separador).toBe(';');
    expect(csv.cabeceras).toEqual(['a', 'b', 'c']);
    expect(csv.filas[0]).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('respeta comillas con separador embebido y tolera BOM/CRLF', () => {
    const csv = parsearCsv('﻿x;y\r\n"hola; mundo";2\r\n');
    expect(csv.cabeceras).toEqual(['x', 'y']);
    expect(csv.filas[0]?.x).toBe('hola; mundo');
  });

  it('resuelve columnas por sinónimos sin importar acentos/mayúsculas', () => {
    const csv = parsearCsv('Razón Social;RIF\nAcme;J-1\n');
    const fila = csv.filas[0] as Record<string, string>;
    expect(columnaPorSinonimos(fila, ['razon_social', 'nombre'])).toBe('Acme');
    expect(columnaPorSinonimos(fila, ['rif'])).toBe('J-1');
  });
});

describe('normalizar montos y fechas', () => {
  it('parsea montos es-VE y en-US', () => {
    expect(parsearMonto('1.234.567,89')).toBe('1234567.89');
    expect(parsearMonto('1,234,567.89')).toBe('1234567.89');
    expect(parsearMonto('1234567.89')).toBe('1234567.89');
    expect(parsearMonto('5.000,00')).toBe('5000');
    expect(parsearMonto('(123,45)')).toBe('-123.45'); // paréntesis contable = negativo
    expect(parsearMonto('')).toBeNull();
  });

  it('parsea fechas dd/mm/yyyy, dd-mm-yyyy e ISO', () => {
    expect(parsearFecha('15/05/2026')).toBe('2026-05-15');
    expect(parsearFecha('15-05-2026')).toBe('2026-05-15');
    expect(parsearFecha('2026-05-15')).toBe('2026-05-15');
    expect(parsearFecha('31/02/2026')).toBeNull(); // fecha imposible
  });

  it('reconversión monetaria histórica (caso 46): Bs.S -> Bs.D divide entre 1e6', () => {
    expect(reescalarVes(new Decimal('5000000000'), 'BS_S_2018').toFixed()).toBe('5000');
    expect(reescalarVes(new Decimal('5000'), 'ACTUAL').toFixed()).toBe('5000');
  });
});

describe('registro de parsers (versionado + autodetección)', () => {
  it('elige el parser GENERICO de TERCEROS por firma de cabeceras', () => {
    const csv = parsearCsv(fx('terceros-generico.csv'));
    const p = elegirParser('TERCEROS', csv.cabeceras, 'terceros-generico.csv');
    expect(p?.version).toBe('terceros-generico-v1');
  });

  it('elige el parser GALAC cuando el nombre de archivo lo indica', () => {
    const csv = parsearCsv(fx('terceros-galac.csv'));
    const p = elegirParser('TERCEROS', csv.cabeceras, 'export-galac.csv');
    expect(p?.sistema).toBe('GALAC');
  });

  it('parsea terceros genéricos a filas canónicas crudas', () => {
    const r = parsearMigracion<TerceroCrudo>('TERCEROS', fx('terceros-generico.csv'), 'terceros-generico.csv');
    expect(r.filas).toHaveLength(5);
    expect(r.filas[0]?.datos).toMatchObject({ tipo: 'cliente', rif: 'J-30112233-0', razonSocial: 'Comercial Norte C.A.' });
  });

  it('parsea Galac mapeando "Razon Social"/"Tipo Contribuyente"/"Pct IVA" por sinónimos', () => {
    const r = parsearMigracion<TerceroCrudo>('TERCEROS', fx('terceros-galac.csv'), 'terceros-galac.csv', 'GALAC');
    expect(r.version).toBe('terceros-galac-v1');
    expect(r.filas[1]?.datos).toMatchObject({ rif: 'E-81234567-5', condicionIva: 'especial', pctRetencionIva: '100' });
  });

  it('parsea ítems, CxC, CxP y saldos genéricos', () => {
    expect(parsearMigracion<ItemCrudo>('ITEMS', fx('items-generico.csv'), 'items.csv').filas).toHaveLength(4);
    expect(parsearMigracion<CuentaAbiertaCruda>('CXC', fx('cxc-generico.csv'), 'cxc.csv').filas).toHaveLength(2);
    expect(parsearMigracion<CuentaAbiertaCruda>('CXP', fx('cxp-generico.csv'), 'cxp.csv').filas).toHaveLength(1);
    expect(parsearMigracion<SaldoCrudo>('SALDOS', fx('saldos-generico.csv'), 'saldos.csv').filas).toHaveLength(3);
  });

  it('parserPorVersion recupera una versión exacta', () => {
    expect(parserPorVersion('items-galac-v1')?.sistema).toBe('GALAC');
    expect(parserPorVersion('inexistente-v9')).toBeUndefined();
  });
});
