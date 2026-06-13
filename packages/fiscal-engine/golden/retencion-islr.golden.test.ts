import { describe, expect, it } from 'vitest';
import { calcularRetencionIslr, type RetencionIslrInput } from '../src/retenciones/retencion-islr';
import golden from './retencion-islr.golden.json';

/**
 * Golden tests de la retención de ISLR por concepto con sustraendo (caso 31 del doc 07). Valores
 * exactos en retencion-islr.golden.json.
 */
describe('Retención de ISLR — golden (doc 07 §C.31)', () => {
  it('caso 31: honorarios PN 3% con sustraendo → 277,50', () => {
    const c = golden.caso31_honorarios_pn_con_retencion;
    expect(calcularRetencionIslr(c.input as RetencionIslrInput)).toEqual(c.esperado);
  });

  it('caso 31: base bajo el umbral → retención 0', () => {
    const c = golden.caso31b_honorarios_pn_bajo_umbral;
    expect(calcularRetencionIslr(c.input as RetencionIslrInput)).toEqual(c.esperado);
  });

  it('caso 31c: PJ servicios 2% sin sustraendo', () => {
    const c = golden.caso31c_servicios_pj_sin_sustraendo;
    expect(calcularRetencionIslr(c.input as RetencionIslrInput)).toEqual(c.esperado);
  });
});
