import { describe, expect, it } from 'vitest';
import {
  ladoOpuesto,
  ladoQueAumenta,
  ladoQueDisminuye,
  naturalezaDeClase,
  saldoNormal,
} from './naturaleza';

describe('naturaleza de cuentas (docs/03 §1)', () => {
  it('mapea cada clase a su naturaleza', () => {
    expect(naturalezaDeClase(1)).toBe('ACTIVO');
    expect(naturalezaDeClase(2)).toBe('PASIVO');
    expect(naturalezaDeClase(3)).toBe('PATRIMONIO');
    expect(naturalezaDeClase(4)).toBe('INGRESO');
    expect(naturalezaDeClase(5)).toBe('COSTO');
    expect(naturalezaDeClase(6)).toBe('GASTO');
  });

  it('rechaza clases fuera de 1–6', () => {
    expect(() => naturalezaDeClase(0)).toThrow(/Clase de cuenta inválida/);
    expect(() => naturalezaDeClase(7)).toThrow(/Clase de cuenta inválida/);
  });

  it('Activo, Costo y Gasto aumentan por débito (saldo deudor)', () => {
    for (const n of ['ACTIVO', 'COSTO', 'GASTO'] as const) {
      expect(ladoQueAumenta(n)).toBe('D');
      expect(saldoNormal(n)).toBe('D');
      expect(ladoQueDisminuye(n)).toBe('C');
    }
  });

  it('Pasivo, Patrimonio e Ingreso aumentan por crédito (saldo acreedor)', () => {
    for (const n of ['PASIVO', 'PATRIMONIO', 'INGRESO'] as const) {
      expect(ladoQueAumenta(n)).toBe('C');
      expect(saldoNormal(n)).toBe('C');
      expect(ladoQueDisminuye(n)).toBe('D');
    }
  });

  it('ladoOpuesto invierte D↔C', () => {
    expect(ladoOpuesto('D')).toBe('C');
    expect(ladoOpuesto('C')).toBe('D');
  });
});
