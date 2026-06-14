import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { diferenciaDias, dos, periodoPrevio, periodoSiguiente, sumaVentas, sumarDias, variacion } from './dashboard-comun';

describe('sumaVentas — agrega ventas NETAS dentro de la ventana (M0)', () => {
  const filas = [
    { tipo: 'FACTURA', fecha: '2026-06-10', ves: '4000', usd: '100' },
    { tipo: 'NOTA_CREDITO', fecha: '2026-06-11', ves: '400', usd: '10' },
    { tipo: 'NOTA_DEBITO', fecha: '2026-06-12', ves: '200', usd: '5' },
    { tipo: 'FACTURA', fecha: '2026-06-30', ves: '9999', usd: '999' }, // fuera de la ventana
  ];

  it('suma facturas/ND y resta notas de crédito en el rango inclusivo', () => {
    const r = sumaVentas(filas, { desde: '2026-06-10', hasta: '2026-06-12' });
    expect(r.ves.toFixed(2)).toBe('3800.00'); // 4000 − 400 + 200
    expect(r.usd.toFixed(2)).toBe('95.00'); // 100 − 10 + 5
  });

  it('excluye documentos fuera de [desde, hasta]', () => {
    const r = sumaVentas(filas, { desde: '2026-06-30', hasta: '2026-06-30' });
    expect(r.ves.toFixed(2)).toBe('9999.00');
  });

  it('trata montos nulos como cero', () => {
    const r = sumaVentas([{ tipo: 'FACTURA', fecha: '2026-06-10', ves: null, usd: null }], { desde: '2026-06-10', hasta: '2026-06-10' });
    expect(r.ves.toFixed(2)).toBe('0.00');
  });
});

describe('variacion — % de actual sobre anterior', () => {
  it('positiva cuando crece', () => {
    expect(variacion(new Decimal(120), new Decimal(100))).toBe('20.0');
  });
  it('negativa cuando cae', () => {
    expect(variacion(new Decimal(80), new Decimal(100))).toBe('-20.0');
  });
  it('null si la base es cero (no comparable)', () => {
    expect(variacion(new Decimal(50), new Decimal(0))).toBeNull();
  });
});

describe('aritmética de fechas civiles', () => {
  it('sumarDias cruza meses', () => {
    expect(sumarDias('2026-06-14', 30)).toBe('2026-07-14');
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
  });
  it('diferenciaDias es positiva si a es posterior', () => {
    expect(diferenciaDias('2026-06-20', '2026-06-14')).toBe(6);
    expect(diferenciaDias('2026-06-10', '2026-06-14')).toBe(-4);
  });
  it('dos redondea a las posiciones pedidas', () => {
    expect(dos('123.456')).toBe('123.46');
    expect(dos('2.5', 4)).toBe('2.5000');
  });
});

describe('períodos contiguos', () => {
  it('periodoPrevio cruza el año', () => {
    expect(periodoPrevio(2026, 1)).toEqual({ anio: 2025, mes: 12 });
    expect(periodoPrevio(2026, 6)).toEqual({ anio: 2026, mes: 5 });
  });
  it('periodoSiguiente cruza el año', () => {
    expect(periodoSiguiente(2026, 12)).toEqual({ anio: 2027, mes: 1 });
    expect(periodoSiguiente(2026, 6)).toEqual({ anio: 2026, mes: 7 });
  });
});
