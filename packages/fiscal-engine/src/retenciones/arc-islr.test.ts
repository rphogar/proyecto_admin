import { describe, expect, it } from 'vitest';
import { consolidarArcIslr } from './arc-islr';

describe('consolidarArcIslr — ARC anual de ISLR (docs/02 §4)', () => {
  it('agrupa por concepto y por mes y cuadra los grandes totales', () => {
    const r = consolidarArcIslr([
      { mes: 1, concepto: '001', baseVes: '10000.00', montoVes: '277.50' },
      { mes: 1, concepto: '002', baseVes: '5000.00', montoVes: '50.00' },
      { mes: 3, concepto: '001', baseVes: '20000.00', montoVes: '577.50' },
    ]);

    const honorarios = r.porConcepto.find((c) => c.concepto === '001');
    expect(honorarios).toEqual({ concepto: '001', baseVes: '30000.00', retenidoVes: '855.00', comprobantes: 2 });
    expect(r.porMes).toEqual([
      { mes: 1, baseVes: '15000.00', retenidoVes: '327.50' },
      { mes: 3, baseVes: '20000.00', retenidoVes: '577.50' },
    ]);
    expect(r.baseTotalVes).toBe('35000.00');
    expect(r.retenidoTotalVes).toBe('905.00');
    expect(r.comprobantes).toBe(3);
  });

  it('un ejercicio sin retenciones da totales en cero', () => {
    const r = consolidarArcIslr([]);
    expect(r.retenidoTotalVes).toBe('0.00');
    expect(r.porConcepto).toEqual([]);
    expect(r.comprobantes).toBe(0);
  });
});
