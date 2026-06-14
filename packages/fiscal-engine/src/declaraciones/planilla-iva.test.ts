import { describe, expect, it } from 'vitest';
import { calcularPlanillaIva } from './planilla-iva';

describe('calcularPlanillaIva — planilla borrador de IVA (forma 99030, docs/02 §3.2)', () => {
  it('cuota a pagar = débito − crédito − retenciones (caso base)', () => {
    const r = calcularPlanillaIva({
      debito: [{ alicuotaTasa: '16', base: '10000.00', monto: '1600.00' }],
      credito: [{ alicuotaTasa: '16', base: '4000.00', monto: '640.00' }],
      retencionesDelPeriodo: '300.00',
    });
    expect(r.debitoFiscal).toBe('1600.00');
    expect(r.creditoFiscalDeducible).toBe('640.00');
    expect(r.porcentajeProrrata).toBe('100.00');
    expect(r.cuotaTributaria).toBe('960.00');
    expect(r.cuotaAPagar).toBe('660.00');
    expect(r.excedenteCreditoSiguiente).toBe('0.00');
    expect(r.excedenteRetencionesSiguiente).toBe('0.00');
  });

  it('crédito > débito → excedente de crédito fiscal trasladable, sin cuota', () => {
    const r = calcularPlanillaIva({
      debito: [{ alicuotaTasa: '16', base: '1000.00', monto: '160.00' }],
      credito: [{ alicuotaTasa: '16', base: '5000.00', monto: '800.00' }],
      retencionesDelPeriodo: '50.00',
    });
    expect(r.cuotaTributaria).toBe('0.00');
    expect(r.excedenteCreditoSiguiente).toBe('640.00');
    expect(r.cuotaAPagar).toBe('0.00');
    // Las retenciones no se consumen (no hay cuota) → se arrastran completas (caso 30).
    expect(r.excedenteRetencionesSiguiente).toBe('50.00');
  });

  it('caso 30 — retenciones acumuladas > cuota → arrastre de excedente de retenciones', () => {
    const r = calcularPlanillaIva({
      debito: [{ alicuotaTasa: '16', base: '10000.00', monto: '1600.00' }],
      credito: [{ alicuotaTasa: '16', base: '2000.00', monto: '320.00' }],
      retencionesDelPeriodo: '1000.00',
      excedenteRetencionesAnterior: '500.00',
    });
    expect(r.cuotaTributaria).toBe('1280.00');
    expect(r.retencionesAcumuladas).toBe('1500.00');
    expect(r.cuotaAPagar).toBe('0.00');
    expect(r.excedenteRetencionesSiguiente).toBe('220.00');
  });

  it('caso 13 — prorrata: con ventas exentas solo es deducible la proporción gravada', () => {
    // Ventas gravadas 80.000 / exentas 20.000 → 80% deducible del crédito común.
    const r = calcularPlanillaIva({
      debito: [{ alicuotaTasa: '16', base: '80000.00', monto: '12800.00' }],
      credito: [{ alicuotaTasa: '16', base: '10000.00', monto: '1600.00' }],
      ventasExentas: '20000.00',
    });
    expect(r.porcentajeProrrata).toBe('80.00');
    expect(r.creditoFiscalDeducible).toBe('1280.00');
    expect(r.creditoFiscalAlCosto).toBe('320.00');
    expect(r.cuotaTributaria).toBe('11520.00');
  });

  it('aplica el excedente de crédito fiscal del período anterior', () => {
    const r = calcularPlanillaIva({
      debito: [{ alicuotaTasa: '16', base: '1000.00', monto: '160.00' }],
      credito: [],
      excedenteCreditoAnterior: '200.00',
    });
    expect(r.cuotaTributaria).toBe('0.00');
    expect(r.excedenteCreditoSiguiente).toBe('40.00');
  });
});
