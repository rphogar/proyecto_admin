import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapearCuentasAbiertas, mapearItems, mapearSaldos, mapearTerceros } from './mapeo';
import { parsearMigracion } from './parsers/registro';
import type { CuentaAbiertaCruda, ItemCrudo, SaldoCrudo, TerceroCrudo } from './parsers/tipos';

const fx = (n: string): string => readFileSync(resolve(__dirname, 'parsers', '__fixtures__', n), 'utf8');
const terceros = (f: string) => parsearMigracion<TerceroCrudo>('TERCEROS', fx(f), f).filas;
const items = () => parsearMigracion<ItemCrudo>('ITEMS', fx('items-generico.csv'), 'items.csv').filas;
const cuentas = (e: 'CXC' | 'CXP', f: string) => parsearMigracion<CuentaAbiertaCruda>(e, fx(f), f).filas;
const saldos = (f: string) => parsearMigracion<SaldoCrudo>('SALDOS', fx(f), f).filas;

describe('mapearTerceros — validación y deduplicación por RIF (caso 45)', () => {
  it('valida, deduplica dentro del archivo y reporta errores por fila', () => {
    const r = mapearTerceros(terceros('terceros-generico.csv'));
    expect(r.total).toBe(5);
    expect(r.aImportar).toBe(3); // 3 únicos válidos
    expect(r.duplicadasEnArchivo).toBe(1); // J-30112233-0 repetido
    expect(r.errores).toHaveLength(1); // fila sin RIF
    expect(r.errores[0]).toMatchObject({ fila: 5, campo: 'rif' });
    const norte = r.validas.find((v) => v.datos.rif === 'J-30112233-0');
    expect(norte?.datos.rifValido).toBe(true);
    expect(norte?.datos.tipo).toBe('cliente');
  });

  it('deduplica contra los terceros ya existentes en el sistema', () => {
    const existentes = new Set(['J-30112233-0']);
    const r = mapearTerceros(terceros('terceros-generico.csv'), { existentes });
    expect(r.duplicadasExistentes).toBe(1);
    expect(r.aImportar).toBe(2); // queda V-... y J-4055...
  });

  it('mapea el SPE como agente de retención con % por defecto 75', () => {
    const r = mapearTerceros(terceros('terceros-generico.csv'));
    const perez = r.validas.find((v) => v.datos.rif === 'V-10203040-7');
    expect(perez?.datos.condicionIva).toBe('especial');
    expect(perez?.datos.esAgenteRetencionIva).toBe(true);
    expect(perez?.datos.pctRetencionIva).toBe('75');
  });
});

describe('mapearItems — costo y alícuota (con dedup por SKU)', () => {
  it('normaliza alícuota/tipo y deduplica por SKU', () => {
    const r = mapearItems(items());
    expect(r.aImportar).toBe(3);
    expect(r.duplicadasEnArchivo).toBe(1);
    const arroz = r.validas.find((v) => v.datos.sku === 'PROD-100');
    expect(arroz?.datos.alicuotaIva).toBe('REDUCIDA');
    expect(arroz?.datos.costo).toBe('1.2');
    expect(arroz?.datos.precio).toBe('2');
  });
});

describe('mapearCuentasAbiertas — CxC/CxP por documento', () => {
  it('exige tasa BCV para divisas y normaliza montos es-VE', () => {
    const r = mapearCuentasAbiertas(cuentas('CXC', 'cxc-generico.csv'));
    expect(r.aImportar).toBe(2);
    const ves = r.validas.find((v) => v.datos.documento === 'FAC-001');
    expect(ves?.datos.monto).toBe('10000');
    expect(ves?.datos.rateBcv).toBeNull();
    const usd = r.validas.find((v) => v.datos.documento === 'FAC-002');
    expect(usd?.datos.rateBcv).toBe('40.5');
  });
});

describe('mapearSaldos — reconversión monetaria (caso 46)', () => {
  it('inventario exige cantidad y fecha de origen', () => {
    const r = mapearSaldos(saldos('saldos-generico.csv'));
    expect(r.aImportar).toBe(3);
    const inv = r.validas.find((v) => v.datos.sku === 'PROD-100');
    expect(inv?.datos.cantidad).toBe('100');
    expect(inv?.datos.fechaOrigen).toBe('2025-12-01');
  });

  it('reescala los Bs en escala vieja a la escala vigente', () => {
    const r = mapearSaldos(saldos('saldos-reconversion-bss.csv'), { escala: 'BS_S_2018' });
    expect(r.validas[0]?.datos.monto).toBe('5000'); // 5.000.000.000 Bs.S / 1e6
  });
});
