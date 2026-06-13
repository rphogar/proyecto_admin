import { describe, expect, it } from 'vitest';
import { calcularRetencionIva, porcentajeRetencionIva } from './retencion-iva';

describe('porcentajeRetencionIva — selección 75/100 (Prov. 0049)', () => {
  it('default 75 cuando no se conoce el proveedor', () => {
    expect(porcentajeRetencionIva()).toBe(75);
  });

  it('toma el % del maestro del tercero (75)', () => {
    expect(porcentajeRetencionIva({ pctProveedor: 75 })).toBe(75);
  });

  it('caso 27 — flag del tercero marca 100', () => {
    expect(porcentajeRetencionIva({ pctProveedor: 100 })).toBe(100);
  });

  it('caso 29 — factura que no discrimina IVA fuerza 100 aunque el proveedor sea 75', () => {
    expect(porcentajeRetencionIva({ pctProveedor: 75, noDiscriminaIva: true })).toBe(100);
  });

  it('caso 29 — factura sin número de control fuerza 100', () => {
    expect(porcentajeRetencionIva({ pctProveedor: 75, sinNumeroControl: true })).toBe(100);
  });

  it('RIF inconsistente fuerza 100', () => {
    expect(porcentajeRetencionIva({ pctProveedor: 75, rifInconsistente: true })).toBe(100);
  });
});

describe('calcularRetencionIva — comportamiento y bordes', () => {
  it('caso 26 — retiene 75% del IVA (160 → 120)', () => {
    const r = calcularRetencionIva({ ivaFactura: '160', porcentaje: 75 });
    expect(r).toEqual({
      porcentaje: '75',
      ivaFactura: '160.00',
      ivaRetenido: '120.00',
      ivaNoRetenido: '40.00',
    });
  });

  it('caso 27 — retiene 100% del IVA', () => {
    const r = calcularRetencionIva({ ivaFactura: '160', porcentaje: 100 });
    expect(r.ivaRetenido).toBe('160.00');
    expect(r.ivaNoRetenido).toBe('0.00');
  });

  it('retenido + no retenido == IVA de la factura (sin perder céntimos)', () => {
    const r = calcularRetencionIva({ ivaFactura: '33.33', porcentaje: 75 });
    expect(Number(r.ivaRetenido) + Number(r.ivaNoRetenido)).toBeCloseTo(33.33, 2);
  });

  it('rechaza porcentajes distintos de 75/100', () => {
    expect(() => calcularRetencionIva({ ivaFactura: '100', porcentaje: 50 })).toThrow(/75 o 100/);
  });

  it('rechaza IVA negativo', () => {
    expect(() => calcularRetencionIva({ ivaFactura: '-1', porcentaje: 75 })).toThrow(/≥ 0/);
  });
});
