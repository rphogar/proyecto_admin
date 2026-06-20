import { describe, expect, it } from 'vitest';
import { evaluarFacturaCompra } from './evaluar-factura-compra';

describe('evaluarFacturaCompra — retención y deducibilidad (caso 29)', () => {
  it('factura correcta (75% proveedor): retiene 75% y el crédito es deducible', () => {
    const r = evaluarFacturaCompra({ discriminaIva: true, numeroControl: '00-12345', pctProveedor: 75 });
    expect(r.pctRetencionIva).toBe(75);
    expect(r.creditoFiscalDeducible).toBe(true);
    expect(r.alertas).toHaveLength(0);
  });

  it('factura que no discrimina IVA → 100% y crédito no deducible + alerta', () => {
    const r = evaluarFacturaCompra({ discriminaIva: false, numeroControl: '00-12345' });
    expect(r.pctRetencionIva).toBe(100);
    expect(r.creditoFiscalDeducible).toBe(false);
    expect(r.alertas.join(' ')).toMatch(/no discrimina/i);
  });

  it('factura sin número de control → crédito no deducible + alerta y 100%', () => {
    const r = evaluarFacturaCompra({ discriminaIva: true, numeroControl: '' });
    expect(r.creditoFiscalDeducible).toBe(false);
    expect(r.pctRetencionIva).toBe(100);
    expect(r.alertas.join(' ')).toMatch(/número de control/i);
  });

  it('RIF inconsistente fuerza 100% pero no afecta la deducibilidad si la factura cumple', () => {
    const r = evaluarFacturaCompra({ discriminaIva: true, numeroControl: '00-1', rifInconsistente: true });
    expect(r.pctRetencionIva).toBe(100);
    expect(r.creditoFiscalDeducible).toBe(true);
    expect(r.alertas.join(' ')).toMatch(/RIF/i);
  });
});
