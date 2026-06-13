import { describe, expect, it } from 'vitest';
import { calcularProrrata } from './prorrata';

describe('calcularProrrata — comportamiento y bordes', () => {
  it('solo ventas gravadas → 100% deducible', () => {
    const r = calcularProrrata({ ventasGravadas: '50000', ventasExentas: '0', creditoComun: '3000' });
    expect(r.porcentajeDeducible).toBe('100.00');
    expect(r.creditoComunDeducible).toBe('3000.00');
    expect(r.creditoComunAlCosto).toBe('0.00');
  });

  it('sin ventas en el período → prudencia: 0% deducible, todo al costo', () => {
    const r = calcularProrrata({ ventasGravadas: '0', ventasExentas: '0', creditoComun: '3000' });
    expect(r.porcentajeDeducible).toBe('0.00');
    expect(r.creditoComunDeducible).toBe('0.00');
    expect(r.creditoComunAlCosto).toBe('3000.00');
  });

  it('deducible + costo == crédito común para cualquier proporción', () => {
    const r = calcularProrrata({ ventasGravadas: '33333.33', ventasExentas: '66666.67', creditoComun: '777.77' });
    const suma = Number(r.creditoComunDeducible) + Number(r.creditoComunAlCosto);
    expect(suma).toBeCloseTo(777.77, 2);
  });

  it('rechaza montos negativos', () => {
    expect(() => calcularProrrata({ ventasGravadas: '-1', ventasExentas: '0', creditoComun: '0' })).toThrow(
      /≥ 0/,
    );
  });
});
