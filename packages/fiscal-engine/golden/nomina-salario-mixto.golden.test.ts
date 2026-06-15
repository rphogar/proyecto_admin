import { describe, expect, it } from 'vitest';
import {
  calcularParafiscales,
  derivarSalarios,
  resolverSalarioNormalMensual,
  type ParafiscalesInput,
  type SalariosInput,
} from '../src/nomina';
import golden from './nomina-salario-mixto.golden.json';

/**
 * Golden test de salario mixto Bs + divisas (caso 48 del doc 07 §G): la conversión a VES, las
 * incidencias sobre el integral y el tope del IVSS/RPE en salarios mínimos. Valores verificados a
 * mano en el JSON.
 */
describe('Nómina — salario mixto y parafiscales topados — golden (caso 48)', () => {
  const c = golden.caso48_salario_mixto;

  it('resuelve el salario normal mensual sumando componentes a su tasa', () => {
    expect(resolverSalarioNormalMensual(c.componentes)).toBe(c.salarioNormalMensualEsperado);
  });

  it('deriva salario diario, alícuotas e integral', () => {
    expect(derivarSalarios(c.salarios.input as SalariosInput)).toEqual(c.salarios.esperado);
  });

  it('calcula parafiscales con IVSS/RPE topados y FAOV sobre el integral', () => {
    expect(calcularParafiscales(c.parafiscales.input as ParafiscalesInput)).toEqual(
      c.parafiscales.esperado,
    );
  });
});
