import { describe, expect, it } from 'vitest';
import { evaluarFormula, FormulaInvalidaError } from './index';
import { validarFormula } from './validar-formula';

describe('motor de fórmulas — evaluación', () => {
  it('aritmética básica con Decimal exacto', () => {
    expect(evaluarFormula('salario_diario * dias * 1.5', { salario_diario: '33.33', dias: 10 }).toFixed(2)).toBe(
      '499.95',
    );
  });

  it('precedencia y paréntesis', () => {
    expect(evaluarFormula('(2 + 3) * 4').toFixed()).toBe('20');
    expect(evaluarFormula('2 + 3 * 4').toFixed()).toBe('14');
  });

  it('funciones whitelisted min/max/round/abs', () => {
    expect(evaluarFormula('min(10, 5, 8)').toFixed()).toBe('5');
    expect(evaluarFormula('max(10, 5, 8)').toFixed()).toBe('10');
    expect(evaluarFormula('round(1.005, 2)').toFixed(2)).toBe('1.01');
    expect(evaluarFormula('abs(0 - 7)').toFixed()).toBe('7');
  });

  it('condicional if(cond, a, b) con comparadores', () => {
    expect(evaluarFormula('if(base > tope, tope, base)', { base: 120, tope: 100 }).toFixed()).toBe('100');
    expect(evaluarFormula('if(base > tope, tope, base)', { base: 80, tope: 100 }).toFixed()).toBe('80');
  });

  it('negación unaria y variables booleanas', () => {
    expect(evaluarFormula('-monto', { monto: 5 }).toFixed()).toBe('-5');
    expect(evaluarFormula('if(activo, salario, 0)', { activo: true, salario: 200 }).toFixed()).toBe('200');
  });
});

describe('motor de fórmulas — seguridad y errores', () => {
  it('rechaza variables fuera del scope', () => {
    expect(() => evaluarFormula('sueldo_oculto + 1', {})).toThrow(FormulaInvalidaError);
  });

  it('rechaza funciones no whitelisted (incluye intentos de evasión)', () => {
    expect(() => evaluarFormula('eval(1)')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('constructor(1)')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('require("fs")')).toThrow(FormulaInvalidaError);
  });

  it('rechaza caracteres no permitidos', () => {
    expect(() => evaluarFormula('a; b')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('a & b')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('a["x"]')).toThrow(FormulaInvalidaError);
  });

  it('rechaza división por cero', () => {
    expect(() => evaluarFormula('10 / 0')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('10 / (5 - 5)')).toThrow(FormulaInvalidaError);
  });

  it('rechaza una fórmula que resuelve a booleano', () => {
    expect(() => evaluarFormula('base > 0', { base: 1 })).toThrow(FormulaInvalidaError);
  });

  it('rechaza sintaxis inválida', () => {
    expect(() => evaluarFormula('2 +')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('(2 + 3')).toThrow(FormulaInvalidaError);
    expect(() => evaluarFormula('')).toThrow(FormulaInvalidaError);
  });
});

describe('validarFormula (estática, para la UI)', () => {
  const permitidas = ['salario_diario', 'dias', 'salario_minimo'];

  it('válida cuando todas las variables están permitidas', () => {
    expect(validarFormula('salario_diario * dias', permitidas)).toEqual([]);
  });

  it('reporta variable no permitida', () => {
    const errores = validarFormula('salario_diario * factor_oculto', permitidas);
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('factor_oculto');
  });

  it('reporta función desconocida y aridad inválida', () => {
    expect(validarFormula('hack(1)', permitidas)[0]).toContain('hack');
    expect(validarFormula('if(dias)', permitidas)[0]).toContain('if');
  });

  it('reporta error de sintaxis', () => {
    expect(validarFormula('dias *', permitidas).length).toBeGreaterThan(0);
  });
});
