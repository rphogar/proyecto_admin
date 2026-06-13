import { describe, expect, it } from 'vitest';
import { calcularIgtf, type PagoIgtf } from '../src/igtf/calcular-igtf';
import golden from './igtf.golden.json';

/**
 * Golden tests del IGTF causado al pago sobre la porción en divisas (casos 4, 34 y 35 del doc 07).
 * Valores exactos en igtf.golden.json.
 */
describe('IGTF al pago — golden (doc 07 §A.4, §D.34, §D.35)', () => {
  it('caso 4: pago mixto Bs + $60 Zelle → IGTF solo sobre $60 = $1,80', () => {
    const c = golden.caso4_pago_mixto;
    expect(calcularIgtf(c.pago as PagoIgtf)).toEqual(c.esperado);
  });

  it('caso 34a: pago 100% en Bs → IGTF 0', () => {
    const c = golden.caso34a_solo_bs;
    expect(calcularIgtf(c.pago as PagoIgtf)).toEqual(c.esperado);
  });

  it('caso 34b: pago en USD efectivo a SPE → 3% percibido', () => {
    const c = golden.caso34b_usd_efectivo_a_spe;
    expect(calcularIgtf(c.pago as PagoIgtf)).toEqual(c.esperado);
  });

  it('caso 34c: empresa no perceptora → no percibe IGTF', () => {
    const c = golden.caso34c_empresa_no_perceptora;
    expect(calcularIgtf(c.pago as PagoIgtf)).toEqual(c.esperado);
  });

  it('caso 35: el IGTF se causa en el anticipo, no se duplica al facturar', () => {
    const c = golden.caso35_anticipo_no_se_duplica;
    expect(calcularIgtf(c.evento_anticipo.pago as PagoIgtf)).toEqual(c.evento_anticipo.esperado);
    expect(calcularIgtf(c.evento_aplicacion_a_factura.pago as PagoIgtf)).toEqual(
      c.evento_aplicacion_a_factura.esperado,
    );
  });
});
