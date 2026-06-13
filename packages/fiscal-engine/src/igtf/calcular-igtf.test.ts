import { describe, expect, it } from 'vitest';
import { calcularIgtf } from './calcular-igtf';

describe('calcularIgtf — comportamiento y bordes', () => {
  it('sin métodos en divisas → no aplica', () => {
    const r = calcularIgtf({
      metodos: [{ moneda: 'VES', montoOrigen: '5000', esDivisa: false }],
      empresaEsPerceptor: true,
    });
    expect(r.aplica).toBe(false);
    expect(r.detalle).toEqual([]);
  });

  it('suma varias porciones de la misma divisa en un solo renglón', () => {
    const r = calcularIgtf({
      metodos: [
        { moneda: 'USD', montoOrigen: '40', esDivisa: true, rateBcv: '40' },
        { moneda: 'USD', montoOrigen: '60', esDivisa: true, rateBcv: '40' },
      ],
      empresaEsPerceptor: true,
    });
    expect(r.detalle).toEqual([{ moneda: 'USD', base: '100.00', igtf: '3.00', igtfVes: '120.00' }]);
    expect(r.igtfTotalVes).toBe('120.00');
  });

  it('múltiples divisas (USD + USDT) → un renglón por moneda y total en Bs', () => {
    const r = calcularIgtf({
      metodos: [
        { moneda: 'USD', montoOrigen: '100', esDivisa: true, rateBcv: '40' },
        { moneda: 'USDT', montoOrigen: '50', esDivisa: true, rateBcv: '40' },
      ],
      empresaEsPerceptor: true,
    });
    expect(r.detalle).toHaveLength(2);
    expect(r.igtfTotalVes).toBe('180.00'); // (100×3% + 50×3%) × 40 = 4.5 × 40
  });

  it('sin tasa BCV en alguna porción → no se puede totalizar en Bs (null), pero sí el IGTF en origen', () => {
    const r = calcularIgtf({
      metodos: [{ moneda: 'USD', montoOrigen: '100', esDivisa: true }],
      empresaEsPerceptor: true,
    });
    expect(r.detalle[0]?.igtf).toBe('3.00');
    expect(r.detalle[0]?.igtfVes).toBeNull();
    expect(r.igtfTotalVes).toBeNull();
  });

  it('alícuota parametrizable (rango legal): 8%', () => {
    const r = calcularIgtf({
      metodos: [{ moneda: 'USD', montoOrigen: '100', esDivisa: true, rateBcv: '40' }],
      empresaEsPerceptor: true,
      alicuota: '8',
    });
    expect(r.alicuota).toBe('8');
    expect(r.detalle[0]?.igtf).toBe('8.00');
  });

  it('porción en divisas de monto cero no genera renglón', () => {
    const r = calcularIgtf({
      metodos: [{ moneda: 'USD', montoOrigen: '0', esDivisa: true, rateBcv: '40' }],
      empresaEsPerceptor: true,
    });
    expect(r.aplica).toBe(false);
  });
});
