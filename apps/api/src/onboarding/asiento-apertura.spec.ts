import { Asiento, verificarCuadre } from '@contave/ledger';
import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import {
  CUENTA_CAPITAL,
  CUENTA_RESULTADOS_ACUMULADOS,
  construirAsientoApertura,
  type RenglonApertura,
} from './asiento-apertura';

const FECHA = new Date('2026-01-01T12:00:00Z');

/** Construye el Asiento del ledger desde la entrada (valida cuadre triple base al construir). */
function asientoDe(renglones: RenglonApertura[], capitalVes: string) {
  const { entradaAsiento, movimientosInventario } = construirAsientoApertura({
    fecha: FECHA,
    renglones,
    capitalVes,
    rateUsdMgmt: '40',
  });
  return { asiento: Asiento.construir(entradaAsiento), movimientosInventario };
}

describe('construirAsientoApertura — cuadre triple base (docs/03 §1, regla 7)', () => {
  it('cuadra en VES/USD/origen con saldos en Bs y en USD', () => {
    const { asiento } = asientoDe(
      [
        { naturaleza: 'ACTIVO', cuenta: '1.1.01', moneda: 'VES', montoOrigen: '1000', rateBcv: null },
        { naturaleza: 'ACTIVO', cuenta: '1.1.04', moneda: 'USD', montoOrigen: '100', rateBcv: '40' },
        { naturaleza: 'PASIVO', cuenta: '2.1', moneda: 'VES', montoOrigen: '500', rateBcv: null },
      ],
      '2000',
    );
    expect(verificarCuadre(asiento.lineas).balanceado).toBe(true);
    // La base fiscal VES cierra: ΣD = ΣC.
    expect(asiento.totalDebeVes().igualA(asiento.totalHaberVes())).toBe(true);
  });

  it('imputa el residual a 3.3 Resultados acumulados (plug) y registra el capital en 3.1', () => {
    const { asiento } = asientoDe(
      [{ naturaleza: 'ACTIVO', cuenta: '1.1.01', moneda: 'VES', montoOrigen: '5000', rateBcv: null }],
      '2000',
    );
    const capital = asiento.lineas.find((l) => l.cuenta === CUENTA_CAPITAL);
    expect(capital?.montoVes.igualA(Money.of('2000', 'VES'))).toBe(true);
    // Activos (5000) − capital (2000) = 3000 a resultados acumulados (haber).
    const plug = asiento.lineas.find((l) => l.cuenta === CUENTA_RESULTADOS_ACUMULADOS);
    expect(plug?.dc).toBe('C');
    expect(plug?.montoVes.igualA(Money.of('3000', 'VES'))).toBe(true);
    expect(verificarCuadre(asiento.lineas).balanceado).toBe(true);
  });

  it('cuadra cada moneda en el origen por separado (bucket por divisa)', () => {
    const { asiento } = asientoDe(
      [
        { naturaleza: 'ACTIVO', cuenta: '1.1.02', moneda: 'USD', montoOrigen: '300', rateBcv: '40' },
        { naturaleza: 'ACTIVO', cuenta: '1.1.06', moneda: 'USDT', montoOrigen: '200', rateBcv: '40' },
      ],
      '0',
    );
    const cuadre = verificarCuadre(asiento.lineas);
    expect(cuadre.balanceado).toBe(true);
    // No quedan descuadres de origen por ninguna moneda.
    expect(cuadre.descuadres.filter((d) => d.base === 'ORIGEN')).toHaveLength(0);
  });

  it('deriva el movimiento de inventario de apertura (costo unitario + fecha de origen)', () => {
    const { asiento, movimientosInventario } = asientoDe(
      [
        {
          naturaleza: 'ACTIVO',
          cuenta: '1.4',
          moneda: 'VES',
          montoOrigen: '4000',
          rateBcv: null,
          itemId: '11111111-1111-1111-1111-111111111111',
          warehouseId: '22222222-2222-2222-2222-222222222222',
          cantidad: '100',
          fechaOrigen: '2025-12-15',
        },
      ],
      '4000',
    );
    expect(verificarCuadre(asiento.lineas).balanceado).toBe(true);
    expect(movimientosInventario).toHaveLength(1);
    const mov = movimientosInventario[0];
    expect(mov?.costoUnitVes).toBe('40.00000000'); // 4000 / 100
    expect(mov?.valorVes).toBe('4000.00');
    expect(mov?.fechaOrigen).toBe('2025-12-15');
  });

  it('cuadra con CxC/CxP por tercero y vencimiento, mezclando Bs y divisas', () => {
    const party = '33333333-3333-3333-3333-333333333333';
    const { asiento } = asientoDe(
      [
        { naturaleza: 'ACTIVO', cuenta: '1.2.01', moneda: 'VES', montoOrigen: '1500', rateBcv: null, partyId: party, vencimiento: '2026-02-01' },
        { naturaleza: 'ACTIVO', cuenta: '1.2.02', moneda: 'USD', montoOrigen: '80', rateBcv: '42', partyId: party },
        { naturaleza: 'PASIVO', cuenta: '2.1', moneda: 'USD', montoOrigen: '30', rateBcv: '42', partyId: party },
      ],
      '1000',
    );
    expect(verificarCuadre(asiento.lineas).balanceado).toBe(true);
  });

  it('rechaza una moneda distinta de VES sin tasa BCV', () => {
    expect(() =>
      construirAsientoApertura({
        fecha: FECHA,
        renglones: [{ naturaleza: 'ACTIVO', cuenta: '1.1.02', moneda: 'USD', montoOrigen: '100', rateBcv: null }],
        capitalVes: '0',
        rateUsdMgmt: '40',
      }),
    ).toThrow(/rateBcv/);
  });
});
