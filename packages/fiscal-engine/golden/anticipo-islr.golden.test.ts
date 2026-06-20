import { describe, expect, it } from 'vitest';
import { type AnticipoInput, calcularAnticipo } from '../src/declaraciones/anticipo';
import golden from './anticipo-islr.golden.json';

/**
 * Golden tests del anticipo de ISLR de SPE (docs/02 §4/§10). Valores exactos en
 * anticipo-islr.golden.json.
 */
describe('Anticipo de ISLR de SPE — golden (docs/02 §10)', () => {
  it('semana base 2%: anticipo = ingresos brutos × alícuota', () => {
    const c = golden.semana_base_2pct;
    expect(calcularAnticipo(c.input as AnticipoInput)).toEqual(c.esperado);
  });

  it('retenciones de ISLR mayores al anticipo → arrastre del excedente', () => {
    const c = golden.con_retenciones_islr;
    expect(calcularAnticipo(c.input as AnticipoInput)).toEqual(c.esperado);
  });
});
