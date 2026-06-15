import { describe, expect, it } from 'vitest';
import { calcularParafiscales, semanasCotizablesDelMes, type ParafiscalesInput } from '../src/nomina';
import golden from './nomina-cinco-lunes.golden.json';

/**
 * Golden test del IVSS en meses con 5 lunes (caso 49 del doc 07 §G): la cotización es por semanas
 * (lunes), de modo que un mes con 5 lunes cotiza 5 semanas. Valores verificados a mano.
 */
describe('Nómina — cotización semanal IVSS — golden (caso 49)', () => {
  it('cuenta los lunes (semanas cotizables) del mes', () => {
    const { diciembre_2024: dic, febrero_2025: feb } = golden.semanas;
    expect(semanasCotizablesDelMes(dic.anio, dic.mes)).toBe(dic.esperado);
    expect(semanasCotizablesDelMes(feb.anio, feb.mes)).toBe(feb.esperado);
  });

  it('caso 49: parafiscales con 5 semanas cotizables', () => {
    const c = golden.caso49_cinco_semanas;
    expect(calcularParafiscales(c.input as ParafiscalesInput)).toEqual(c.esperado);
  });
});
