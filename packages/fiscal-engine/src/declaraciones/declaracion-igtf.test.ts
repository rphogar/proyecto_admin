import { describe, expect, it } from 'vitest';
import { calcularDeclaracionIgtf } from './declaracion-igtf';

describe('calcularDeclaracionIgtf — IGTF percibido del período (docs/02 §5)', () => {
  it('agrega percepciones por alícuota y totaliza', () => {
    const r = calcularDeclaracionIgtf([
      { alicuota: '3', baseVes: '15000.00', igtfVes: '450.00' },
      { alicuota: '3', baseVes: '6000.00', igtfVes: '180.00' },
    ]);
    expect(r.grupos).toEqual([{ alicuota: '3', baseVes: '21000.00', igtfVes: '630.00', operaciones: 2 }]);
    expect(r.baseTotalVes).toBe('21000.00');
    expect(r.igtfTotalVes).toBe('630.00');
    expect(r.operaciones).toBe(2);
  });

  it('separa alícuotas distintas, orden descendente', () => {
    const r = calcularDeclaracionIgtf([
      { alicuota: '3', baseVes: '1000.00', igtfVes: '30.00' },
      { alicuota: '5', baseVes: '2000.00', igtfVes: '100.00' },
    ]);
    expect(r.grupos.map((g) => g.alicuota)).toEqual(['5', '3']);
    expect(r.igtfTotalVes).toBe('130.00');
  });

  it('período sin percepciones → cero', () => {
    const r = calcularDeclaracionIgtf([]);
    expect(r).toEqual({ grupos: [], baseTotalVes: '0.00', igtfTotalVes: '0.00', operaciones: 0 });
  });
});
