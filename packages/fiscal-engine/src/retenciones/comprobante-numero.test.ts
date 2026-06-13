import { describe, expect, it } from 'vitest';
import { formatearNumeroComprobante, parsearNumeroComprobante } from './comprobante-numero';

describe('formatearNumeroComprobante — AAAAMMNNNNNNNN', () => {
  it('arma el número con relleno de ceros', () => {
    expect(formatearNumeroComprobante({ anio: 2026, mes: 6 }, 1)).toBe('20260600000001');
  });

  it('mes de dos dígitos y correlativo grande', () => {
    expect(formatearNumeroComprobante({ anio: 2026, mes: 12 }, 12_345_678)).toBe('20261212345678');
  });

  it('rechaza mes inválido', () => {
    expect(() => formatearNumeroComprobante({ anio: 2026, mes: 13 }, 1)).toThrow(/mes/);
  });

  it('rechaza correlativo fuera de rango', () => {
    expect(() => formatearNumeroComprobante({ anio: 2026, mes: 6 }, 0)).toThrow(/correlativo/);
    expect(() => formatearNumeroComprobante({ anio: 2026, mes: 6 }, 100_000_000)).toThrow(/correlativo/);
  });
});

describe('parsearNumeroComprobante', () => {
  it('round-trip con el formateador', () => {
    const n = formatearNumeroComprobante({ anio: 2026, mes: 6 }, 42);
    expect(parsearNumeroComprobante(n)).toEqual({ anio: 2026, mes: 6, correlativo: 42 });
  });

  it('rechaza cadenas que no cumplen el formato', () => {
    expect(parsearNumeroComprobante('2026-06-0001')).toBeNull();
    expect(parsearNumeroComprobante('20261300000001')).toBeNull(); // mes 13
  });
});
