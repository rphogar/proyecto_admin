import { describe, expect, it } from 'vitest';
import { calcularRetencionIslr, FACTOR_SUSTRAENDO_PN, sustraendoIslr } from './retencion-islr';

describe('calcularRetencionIslr — concepto, tarifa y sustraendo (Decreto 1.808)', () => {
  it('PJ domiciliada — sin sustraendo: honorarios 5% sobre 10.000 = 500', () => {
    const r = calcularRetencionIslr({ base: '10000', tarifa: '5' });
    expect(r.retencion).toBe('500.00');
    expect(r.sustraendo).toBe('0.00');
    expect(r.bajoUmbral).toBe(false);
  });

  it('caso 31 — honorarios a PN 3% con sustraendo 22,50 sobre 10.000', () => {
    const r = calcularRetencionIslr({ base: '10000', tarifa: '3', sustraendo: '22.50' });
    // 10.000 × 3% − 22,50 = 300 − 22,50 = 277,50
    expect(r.retencion).toBe('277.50');
    expect(r.bajoUmbral).toBe(false);
  });

  it('caso 31 — base bajo el umbral: 500 × 3% (15) ≤ sustraendo 22,50 → retención 0', () => {
    const r = calcularRetencionIslr({ base: '500', tarifa: '3', sustraendo: '22.50' });
    expect(r.retencion).toBe('0.00');
    expect(r.bajoUmbral).toBe(true);
  });

  it('servicios PJ 2% sin sustraendo', () => {
    const r = calcularRetencionIslr({ base: '8000', tarifa: '2' });
    expect(r.retencion).toBe('160.00');
  });

  it('rechaza base negativa', () => {
    expect(() => calcularRetencionIslr({ base: '-1', tarifa: '3' })).toThrow(/≥ 0/);
  });
});

describe('sustraendoIslr — derivación del sustraendo de PN (UT × factor × tarifa%)', () => {
  it('UT 9, tarifa 3%, factor 83,3334 → 22,50', () => {
    expect(sustraendoIslr({ valorUt: '9', tarifa: '3' })).toBe('22.50');
  });

  it('usa el factor por defecto documentado', () => {
    expect(FACTOR_SUSTRAENDO_PN).toBe('83.3334');
  });
});
