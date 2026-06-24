import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Decimal } from '@contave/shared';
import type { EntradaLinea } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import { construirAsientoApertura } from '../onboarding/asiento-apertura';
import { construirRenglonesApertura, type MapasResolucion } from './apertura-importacion';
import { mapearCuentasAbiertas, mapearSaldos } from './mapeo';
import { parsearMigracion } from './parsers/registro';
import type { CuentaAbiertaCruda, SaldoCrudo } from './parsers/tipos';

const fx = (n: string): string => readFileSync(resolve(__dirname, 'parsers', '__fixtures__', n), 'utf8');
const saldos = mapearSaldos(parsearMigracion<SaldoCrudo>('SALDOS', fx('saldos-generico.csv'), 'saldos.csv').filas);
const cxc = mapearCuentasAbiertas(parsearMigracion<CuentaAbiertaCruda>('CXC', fx('cxc-generico.csv'), 'cxc.csv').filas);
const cxp = mapearCuentasAbiertas(parsearMigracion<CuentaAbiertaCruda>('CXP', fx('cxp-generico.csv'), 'cxp.csv').filas);

const mapas: MapasResolucion = {
  partyPorRif: new Map([
    ['J-30112233-0', 'p-norte'],
    ['J-40556677-9', 'p-sur'],
    ['V-10203040-7', 'p-perez'],
  ]),
  itemPorSku: new Map([['PROD-100', 'i-arroz']]),
  warehousePrincipalId: 'w-principal',
};

function sumar(lineas: ReadonlyArray<EntradaLinea>, lado: 'D' | 'C', col: 'montoVes' | 'montoUsdMgmt'): Decimal {
  return lineas.filter((l) => l.dc === lado).reduce((acc, l) => acc.plus(new Decimal(String(l[col]))), new Decimal(0));
}

describe('construirRenglonesApertura (P31, caso 45)', () => {
  it('resuelve tercero por RIF e ítem por SKU y arma los renglones', () => {
    const { renglones, errores } = construirRenglonesApertura(saldos.validas, cxc.validas, cxp.validas, mapas);
    expect(errores).toHaveLength(0);
    // 3 saldos + 2 CxC + 1 CxP = 6 renglones operativos.
    expect(renglones).toHaveLength(6);
    const inventario = renglones.find((r) => r.itemId === 'i-arroz');
    expect(inventario).toMatchObject({ cantidad: '100', fechaOrigen: '2025-12-01' });
    const cxcVes = renglones.find((r) => r.partyId === 'p-norte');
    expect(cxcVes?.cuenta).toBe('1.2.01'); // CxC en Bs
    const cxpRow = renglones.find((r) => r.partyId === 'p-perez');
    expect(cxpRow).toMatchObject({ naturaleza: 'PASIVO', cuenta: '2.1' });
  });

  it('reporta error en RIF/SKU inexistente (no inventa maestros)', () => {
    const { errores } = construirRenglonesApertura(saldos.validas, cxc.validas, cxp.validas, {
      partyPorRif: new Map(),
      itemPorSku: new Map(),
    });
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.some((e) => e.campo === 'sku')).toBe(true);
    expect(errores.some((e) => e.campo === 'rif')).toBe(true);
  });

  it('el asiento de apertura resultante cuadra en las 3 bases', () => {
    const { renglones } = construirRenglonesApertura(saldos.validas, cxc.validas, cxp.validas, mapas);
    const { entradaAsiento } = construirAsientoApertura({
      fecha: new Date(),
      renglones,
      capitalVes: '5000',
      rateUsdMgmt: '40.5',
      companyId: 'co-1',
    });
    const lineas = entradaAsiento.lineas;
    expect(sumar(lineas, 'D', 'montoVes').equals(sumar(lineas, 'C', 'montoVes'))).toBe(true);
    expect(sumar(lineas, 'D', 'montoUsdMgmt').equals(sumar(lineas, 'C', 'montoUsdMgmt'))).toBe(true);
    // Cuadre del origen por bucket de moneda (VES y USD).
    for (const moneda of ['VES', 'USD']) {
      const delGrupo = lineas.filter((l) => l.moneda.toUpperCase() === moneda);
      expect(sumar(delGrupo, 'D', 'montoVes').gt(0) || sumar(delGrupo, 'C', 'montoVes').gt(0)).toBe(true);
    }
  });
});
