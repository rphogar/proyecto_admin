import { describe, expect, it } from 'vitest';
import { calcularProrrata, type ProrrataInput } from '../src/iva/prorrata';
import golden from './prorrata.golden.json';

/**
 * Golden tests de la prorrata mensual del crédito fiscal (caso 13 del doc 07). Valores exactos en
 * prorrata.golden.json.
 */
describe('Prorrata del crédito fiscal — golden (doc 07 §B.13)', () => {
  it('caso 13: 80% deducible, 20% al costo', () => {
    const c = golden.caso13_prorrata_80_20;
    expect(calcularProrrata(c.input as ProrrataInput)).toEqual(c.esperado);
  });

  it('caso 13b: créditos directos no entran a la prorrata', () => {
    const c = golden.caso13b_con_creditos_directos;
    expect(calcularProrrata(c.input as ProrrataInput)).toEqual(c.esperado);
  });

  it('caso 13c: proporción no exacta — deducible + costo suman el común sin perder céntimos', () => {
    const c = golden.caso13c_proporcion_no_exacta;
    const r = calcularProrrata(c.input as ProrrataInput);
    expect(r).toEqual(c.esperado);
    // Invariante: el común deducible + el común al costo == crédito común exacto.
    expect(Number(r.creditoComunDeducible) + Number(r.creditoComunAlCosto)).toBeCloseTo(
      Number(c.input.creditoComun),
      2,
    );
  });
});
