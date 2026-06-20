import { describe, expect, it } from 'vitest';
import { type AnticipoInput, calcularAnticipo } from '../src/declaraciones/anticipo';
import golden from './anticipo-iva.golden.json';

/**
 * Golden tests del anticipo de IVA de SPE (docs/02 §3.2/§10; casos 34/35 para la no duplicación con
 * el IGTF). Valores exactos en anticipo-iva.golden.json.
 */
describe('Anticipo de IVA de SPE — golden (docs/02 §10)', () => {
  it('quincena base 1%: anticipo = ingresos brutos × alícuota', () => {
    const c = golden.quincena_base_1pct;
    expect(calcularAnticipo(c.input as AnticipoInput)).toEqual(c.esperado);
  });

  it('descuenta retenciones soportadas y anticipos previos', () => {
    const c = golden.con_retenciones_soportadas;
    expect(calcularAnticipo(c.input as AnticipoInput)).toEqual(c.esperado);
  });

  it('caso 34: la base son los ingresos brutos, sin el IGTF percibido (no se duplica)', () => {
    const c = golden.base_excluye_igtf_caso34;
    expect(calcularAnticipo(c.input as AnticipoInput)).toEqual(c.esperado);
  });
});
