import { Asiento } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import {
  armarAsientoAjuste,
  armarAsientoCostoVenta,
  armarAsientoEntrada,
  CUENTA_COSTO_VENTA,
  CUENTA_GASTO_NO_DEDUCIBLE,
  CUENTA_INVENTARIO,
  CUENTA_MERMA_DEDUCIBLE,
  CUENTA_OTROS_INGRESOS,
} from './asientos-inventario';

const FECHA = new Date('2026-06-12T14:00:00.000Z');

/** Cada asiento debe cuadrar (lo valida `Asiento.construir`) e imputar a las cuentas correctas. */
describe('asientos de inventario (P12)', () => {
  function lados(asiento: Asiento): { cuenta: string; dc: string }[] {
    return asiento.lineas.map((l) => ({ cuenta: l.cuenta, dc: l.dc }));
  }

  it('costo de venta: D 5.1 / C 1.4, cuadrado en triple base', () => {
    const e = armarAsientoCostoVenta({
      fecha: FECHA,
      descripcion: 'COGS',
      costo: { ves: '2750.00000000', usd: '10.55555556' },
    });
    expect(e).toBeDefined();
    const a = Asiento.construir(e!); // construir lanza si ΣD≠ΣC en alguna base
    expect(lados(a)).toEqual(
      expect.arrayContaining([
        { cuenta: CUENTA_COSTO_VENTA, dc: 'D' },
        { cuenta: CUENTA_INVENTARIO, dc: 'C' },
      ]),
    );
  });

  it('costo de venta 0 (venta en negativo sin stock valorado) → sin asiento', () => {
    expect(
      armarAsientoCostoVenta({ fecha: FECHA, descripcion: 'COGS', costo: { ves: '0', usd: '0' } }),
    ).toBeUndefined();
  });

  it('entrada de inventario: D 1.4 / C contrapartida', () => {
    const e = armarAsientoEntrada({
      fecha: FECHA,
      descripcion: 'Compra',
      costo: { ves: '25000', usd: '100' },
      cuentaContrapartida: '2.1',
    });
    const a = Asiento.construir(e!);
    expect(lados(a)).toEqual(
      expect.arrayContaining([
        { cuenta: CUENTA_INVENTARIO, dc: 'D' },
        { cuenta: '2.1', dc: 'C' },
      ]),
    );
  });

  it('ajuste merma deducible: D 6.3 / C 1.4', () => {
    const e = armarAsientoAjuste({
      fecha: FECHA,
      descripcion: 'Merma',
      deducible: true,
      lineas: [{ direccion: 'SALIDA', valorVes: '500', valorUsd: '12.5' }],
    });
    const a = Asiento.construir(e!);
    expect(lados(a)).toEqual(
      expect.arrayContaining([
        { cuenta: CUENTA_MERMA_DEDUCIBLE, dc: 'D' },
        { cuenta: CUENTA_INVENTARIO, dc: 'C' },
      ]),
    );
  });

  it('ajuste merma NO deducible va a 6.8 (caso 40)', () => {
    const e = armarAsientoAjuste({
      fecha: FECHA,
      descripcion: 'Robo',
      deducible: false,
      lineas: [{ direccion: 'SALIDA', valorVes: '500', valorUsd: '12.5' }],
    });
    expect(e!.lineas.some((l) => l.cuenta === CUENTA_GASTO_NO_DEDUCIBLE && l.dc === 'D')).toBe(
      true,
    );
  });

  it('ajuste sobrante: D 1.4 / C 4.6 Otros ingresos', () => {
    const e = armarAsientoAjuste({
      fecha: FECHA,
      descripcion: 'Sobrante',
      deducible: false,
      lineas: [{ direccion: 'ENTRADA', valorVes: '500', valorUsd: '12.5' }],
    });
    const a = Asiento.construir(e!);
    expect(lados(a)).toEqual(
      expect.arrayContaining([
        { cuenta: CUENTA_INVENTARIO, dc: 'D' },
        { cuenta: CUENTA_OTROS_INGRESOS, dc: 'C' },
      ]),
    );
  });
});
