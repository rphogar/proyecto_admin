import { describe, expect, it } from 'vitest';
import {
  calcularPrestacionesArt142,
  interesesPrestaciones,
  type MovimientoInteres,
  type PrestacionesArt142Input,
} from '../src/nomina';
import golden from './nomina-prestaciones-art142.golden.json';

/**
 * Golden test del doble cálculo de prestaciones del art. 142 LOTTT (caso 50 del doc 07 §G): se paga
 * el mayor entre la garantía acumulada y el retroactivo; se descuentan anticipos; se agrega la
 * indemnización del art. 92 ante despido injustificado. Valores verificados a mano.
 */
describe('Nómina — prestaciones art. 142 doble cálculo — golden (caso 50)', () => {
  it('caso 50: retroactivo mayor, con anticipos e indemnización art. 92', () => {
    const c = golden.caso50_retroactivo_mayor;
    expect(calcularPrestacionesArt142(c.input as PrestacionesArt142Input)).toEqual(c.esperado);
  });

  it('caso 50b: garantía mayor, sin despido injustificado', () => {
    const c = golden.caso50b_garantia_mayor;
    expect(calcularPrestacionesArt142(c.input as PrestacionesArt142Input)).toEqual(c.esperado);
  });

  it('intereses sobre prestaciones capitalizados anualmente', () => {
    const c = golden.intereses_capitalizados;
    expect(interesesPrestaciones(c.movimientos as MovimientoInteres[])).toEqual(c.esperado);
  });
});
