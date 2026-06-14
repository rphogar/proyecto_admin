import { describe, expect, it } from 'vitest';
import {
  calcularKardex,
  costoVigente,
  type MovimientoKardex,
  StockInsuficienteError,
} from './kardex';

/**
 * Tests del motor de kardex (más allá del golden 37): venta en negativo (caso 38), traslado/entrada
 * valorada al promedio (forma B) y vaciado de stock sin residuo.
 */
describe('kardex — costo promedio ponderado móvil doble base', () => {
  const compra = (
    cantidad: string,
    moneda: 'VES' | 'USD',
    costoUnit: string,
    rateBcv: string,
  ): MovimientoKardex => ({
    tipo: 'COMPRA',
    direccion: 'ENTRADA',
    cantidad,
    costo: { moneda, costoUnit, rateBcv },
  });

  it('bloquea la salida con stock insuficiente por defecto (caso 38)', () => {
    const movs: MovimientoKardex[] = [
      compra('5', 'USD', '10', '40'),
      { tipo: 'VENTA', direccion: 'SALIDA', cantidad: '8' },
    ];
    expect(() => calcularKardex(movs)).toThrow(StockInsuficienteError);
  });

  it('permite venta en negativo si se habilita, valorando al último promedio (caso 38)', () => {
    const movs: MovimientoKardex[] = [
      compra('5', 'USD', '10', '40'),
      { tipo: 'VENTA', direccion: 'SALIDA', cantidad: '8' },
    ];
    const k = calcularKardex(movs, { permitirNegativo: true });
    expect(k.saldoCantidad).toBe('-3');
    // La salida usó el promedio vigente ($10 / Bs 400).
    expect(k.filas[1]!.costoUnitUsd).toBe('10.00000000');
    expect(k.filas[1]!.costoUnitVes).toBe('400.00000000');
  });

  it('vacía el stock sin dejar residuo de céntimos (promedio no terminante)', () => {
    // 3 und a $10 (tasa 30 → Bs 300/und): promedio Bs perfecto, USD perfecto; vender todo → saldo 0.
    const movs: MovimientoKardex[] = [
      compra('3', 'USD', '10', '30'),
      { tipo: 'VENTA', direccion: 'SALIDA', cantidad: '3' },
    ];
    const k = calcularKardex(movs);
    expect(k.saldoCantidad).toBe('0');
    expect(k.saldoValorVes).toBe('0.00000000');
    expect(k.saldoValorUsd).toBe('0.00000000');
    expect(k.costoPromedioVes).toBe('0.00000000');
  });

  it('acepta entrada valorada en doble base explícita (forma B: traslado/sobrante al promedio)', () => {
    const movs: MovimientoKardex[] = [
      compra('10', 'USD', '10', '40'), // promedio $10 / Bs 400
      {
        tipo: 'TRASLADO',
        direccion: 'ENTRADA',
        cantidad: '5',
        costo: { costoUnitVes: '400', costoUnitUsd: '10' },
      },
    ];
    const k = calcularKardex(movs);
    expect(k.saldoCantidad).toBe('15');
    expect(k.costoPromedioUsd).toBe('10.00000000');
    expect(k.costoPromedioVes).toBe('400.00000000');
  });

  it('costoVigente devuelve el promedio tras los movimientos', () => {
    const c = costoVigente([compra('10', 'USD', '10', '250'), compra('10', 'VES', '3000', '270')]);
    expect(c.saldoCantidad).toBe('20');
    expect(c.costoPromedioVes).toBe('2750.00000000');
    expect(c.costoPromedioUsd).toBe('10.55555556');
  });
});
