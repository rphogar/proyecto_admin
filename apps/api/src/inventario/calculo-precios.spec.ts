import { describe, expect, it } from 'vitest';
import { calcularPreciosMasivo, type ItemPrecioActual } from './calculo-precios';

/** Tests del cálculo puro de actualización masiva de precios (doc 06 M5). */
describe('calcularPreciosMasivo', () => {
  const items: ItemPrecioActual[] = [
    { itemId: 'a', descripcion: 'Item A', precioActual: '100', costo: '80' },
    { itemId: 'b', descripcion: 'Item B', precioActual: '50', costo: null },
  ];

  it('PORCENTAJE sube todos los precios un % y reporta la variación', () => {
    const r = calcularPreciosMasivo(items, { modo: 'PORCENTAJE', valor: '10' });
    expect(r.lineas[0]!.precioNuevo).toBe('110.00');
    expect(r.lineas[0]!.variacionPct).toBe('10.00');
    expect(r.lineas[1]!.precioNuevo).toBe('55.00');
  });

  it('MARGEN_COSTO fija el precio como costo × (1 + margen) y marca sinDato si falta costo', () => {
    const r = calcularPreciosMasivo(items, { modo: 'MARGEN_COSTO', valor: '25' });
    expect(r.lineas[0]!.precioNuevo).toBe('100.00'); // 80 × 1,25
    expect(r.lineas[0]!.sinDato).toBe(false);
    expect(r.lineas[1]!.sinDato).toBe(true); // sin costo → deja el precio actual
    expect(r.lineas[1]!.precioNuevo).toBe('50.00');
  });

  it('TASA re-expresa el precio por la relación de tasas', () => {
    const r = calcularPreciosMasivo([{ itemId: 'a', descripcion: 'A', precioActual: '1000' }], {
      modo: 'TASA',
      valor: '40', // tasa nueva
      tasaActual: '36',
    });
    // 1000 × 40/36 = 1111,11
    expect(r.lineas[0]!.precioNuevo).toBe('1111.11');
  });

  it('aplica redondeo psicológico .99', () => {
    const r = calcularPreciosMasivo(
      [{ itemId: 'a', descripcion: 'A', precioActual: '100', costo: '80' }],
      {
        modo: 'MARGEN_COSTO',
        valor: '30', // 80 × 1,3 = 104 → 103,99
        redondeo: 'TERMINACION_99',
      },
    );
    expect(r.lineas[0]!.precioNuevo).toBe('103.99');
  });

  it('redondeo a ENTERO', () => {
    const r = calcularPreciosMasivo([{ itemId: 'a', descripcion: 'A', precioActual: '100' }], {
      modo: 'PORCENTAJE',
      valor: '7.4', // 107,4 → 107
      redondeo: 'ENTERO',
    });
    expect(r.lineas[0]!.precioNuevo).toBe('107.00');
  });
});
