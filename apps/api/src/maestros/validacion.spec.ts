import { describe, expect, it } from 'vitest';
import {
  optionalBoolean,
  optionalDecimal,
  optionalInt,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from './validacion';

describe('validacion de maestros (P5)', () => {
  describe('requireString', () => {
    it('recorta y exige no vacío', () => {
      expect(requireString('  Caja  ', 'nombre')).toBe('Caja');
      expect(() => requireString('   ', 'nombre')).toThrow(/obligatorio/);
    });
    it('rechaza por longitud', () => {
      expect(() => requireString('x'.repeat(31), 'codigo', 30)).toThrow(/excede/);
    });
  });

  describe('requireEnum', () => {
    it('normaliza con transform y valida el conjunto', () => {
      expect(requireEnum('producto', 'tipo', ['producto', 'servicio'] as const, (s) => s.toLowerCase())).toBe(
        'producto',
      );
      expect(requireEnum('GENERAL', 'a', ['GENERAL'] as const, (s) => s.toUpperCase())).toBe('GENERAL');
      expect(() => requireEnum('otro', 'tipo', ['producto'] as const)).toThrow(/inválido/);
    });
  });

  describe('requireDecimal (regla 1: nunca float silencioso)', () => {
    it('preserva precisión y exige positivo por defecto', () => {
      expect(requireDecimal('10.50', 'precio')).toBe('10.5');
      expect(() => requireDecimal('0', 'precio')).toThrow(/positivo/);
      expect(() => requireDecimal('-1', 'precio')).toThrow(/positivo/);
      expect(() => requireDecimal('abc', 'precio')).toThrow(/inválido/);
    });
    it('permitirCero relaja a >= 0', () => {
      expect(requireDecimal('0', 'precio', true)).toBe('0');
      expect(() => requireDecimal('-0.01', 'precio', true)).toThrow(/no negativo/);
    });
  });

  describe('optionalDecimal / optionalInt / optionalBoolean', () => {
    it('optionalDecimal devuelve null si ausente', () => {
      expect(optionalDecimal(undefined, 'x')).toBeNull();
      expect(optionalDecimal('', 'x')).toBeNull();
      expect(optionalDecimal('5', 'x')).toBe('5');
    });
    it('optionalInt aplica default y mínimo', () => {
      expect(optionalInt(undefined, 'dias', 0)).toBe(0);
      expect(optionalInt('30', 'dias', 0)).toBe(30);
      expect(() => optionalInt('-1', 'dias', 0)).toThrow(/entero/);
      expect(() => optionalInt('1.5', 'dias', 0)).toThrow(/entero/);
    });
    it('optionalBoolean acepta string y booleano', () => {
      expect(optionalBoolean(undefined, true)).toBe(true);
      expect(optionalBoolean('false', true)).toBe(false);
      expect(optionalBoolean(true, false)).toBe(true);
      expect(() => optionalBoolean('quizas', false)).toThrow(/booleano/);
    });
  });

  describe('requireUuid', () => {
    it('valida formato y normaliza a minúsculas', () => {
      expect(requireUuid('A1B2C3D4-1111-2222-3333-444455556666', 'id')).toBe(
        'a1b2c3d4-1111-2222-3333-444455556666',
      );
      expect(() => requireUuid('no-uuid', 'id')).toThrow(/UUID/);
    });
  });
});
