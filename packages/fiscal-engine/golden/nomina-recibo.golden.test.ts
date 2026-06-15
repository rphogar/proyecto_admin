import { describe, expect, it } from 'vitest';
import { calcularReciboNomina, type ConceptoNomina } from '../src/nomina';
import golden from './nomina-recibo.golden.json';

/**
 * Golden test del recibo de nómina con prorrateo por ingreso a mitad de período (caso 47 del doc
 * 07 §G). Los valores esperados están en el JSON, verificados a mano; el runner solo afirma que el
 * motor los reproduce EXACTAMENTE.
 */
describe('Nómina — recibo con prorrateo — golden (caso 47)', () => {
  it('caso 47: ingreso día 20 (12 días efectivos), cestaticket proporcional', () => {
    const c = golden.caso47_ingreso_medio_periodo;
    expect(
      calcularReciboNomina({
        conceptos: c.input.conceptos as ConceptoNomina[],
        scope: c.input.scope,
      }),
    ).toEqual(c.esperado);
  });
});
