import { describe, expect, it } from 'vitest';
import { calcularAnticipo } from './anticipo';

describe('calcularAnticipo — anticipo de IVA/ISLR de SPE (docs/02 §3.2/§10)', () => {
  it('anticipo = ingresos brutos × alícuota (caso base, sin créditos)', () => {
    const r = calcularAnticipo({ ingresosBrutos: '50000.00', porcentaje: '1' });
    expect(r.baseImponible).toBe('50000.00');
    expect(r.porcentaje).toBe('1.00');
    expect(r.anticipoCalculado).toBe('500.00');
    expect(r.creditosAplicados).toBe('0.00');
    expect(r.anticipoAPagar).toBe('500.00');
    expect(r.excedenteCreditosSiguiente).toBe('0.00');
  });

  it('descuenta retenciones y anticipos previos del anticipo a pagar', () => {
    const r = calcularAnticipo({
      ingresosBrutos: '100000.00',
      porcentaje: '2',
      retencionesAcumuladas: '800.00',
      anticiposPagadosAcumulados: '400.00',
    });
    expect(r.anticipoCalculado).toBe('2000.00');
    expect(r.creditosAplicados).toBe('1200.00');
    expect(r.anticipoAPagar).toBe('800.00');
    expect(r.excedenteCreditosSiguiente).toBe('0.00');
  });

  it('créditos > anticipo calculado → no se paga y el excedente se arrastra', () => {
    const r = calcularAnticipo({
      ingresosBrutos: '10000.00',
      porcentaje: '1',
      retencionesAcumuladas: '300.00',
    });
    expect(r.anticipoCalculado).toBe('100.00');
    expect(r.creditosAplicados).toBe('100.00');
    expect(r.anticipoAPagar).toBe('0.00');
    expect(r.excedenteCreditosSiguiente).toBe('200.00');
  });

  it('rechaza base o porcentaje negativos/inválidos', () => {
    expect(() => calcularAnticipo({ ingresosBrutos: '-1', porcentaje: '1' })).toThrow();
    expect(() => calcularAnticipo({ ingresosBrutos: '100', porcentaje: 'x' })).toThrow();
  });
});
