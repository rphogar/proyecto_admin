import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calcularDigitoVerificadorRif, esRifValido, validarRif } from './rif';

/**
 * Vectores ancla calculados a mano con el algoritmo módulo-11 documentado, para fijar el
 * orden de FACTORES [3,2,7,6,5,4,3,2] y los valores de letra (V=1,E=2,J=3,P=4,G=5)
 * independientemente de la implementación.
 *
 * NOTA: antes de producción, la tributarista debe confirmar al menos uno contra un RIF
 * real de SENIAT (la auto-consistencia se prueba además con fast-check más abajo).
 */
const VALIDOS = [
  'J-12345678-4', // J:12 + 138 = 150 → 150%11=7 → 11-7=4
  'V-12345678-1', // V:4  + 138 = 142 → 142%11=10 → 11-10=1
  'J-00000000-0', // 12 → 12%11=1 → 11-1=10 → 0
  'V-00000000-7', // 4  → 4%11=4 → 11-4=7
];

describe('calcularDigitoVerificadorRif', () => {
  it('coincide con los vectores ancla', () => {
    expect(calcularDigitoVerificadorRif('J', '12345678')).toBe(4);
    expect(calcularDigitoVerificadorRif('V', '12345678')).toBe(1);
    expect(calcularDigitoVerificadorRif('J', '00000000')).toBe(0);
  });
  it('rechaza tipo o longitud inválidos', () => {
    expect(() => calcularDigitoVerificadorRif('X', '12345678')).toThrow();
    expect(() => calcularDigitoVerificadorRif('J', '123')).toThrow();
  });
});

describe('validarRif — válidos', () => {
  it.each(VALIDOS)('acepta %s', (rif) => {
    const r = validarRif(rif);
    expect(r.valido).toBe(true);
    expect(r.normalizado).toBe(rif);
  });

  it('normaliza entrada sin guiones, con espacios y minúsculas', () => {
    expect(validarRif('j123456784')).toEqual({ valido: true, normalizado: 'J-12345678-4' });
    expect(validarRif('  V-12345678-1 ')).toEqual({
      valido: true,
      normalizado: 'V-12345678-1',
    });
  });

  it('esRifValido', () => {
    expect(esRifValido('J-12345678-4')).toBe(true);
    expect(esRifValido('J-12345678-5')).toBe(false);
  });
});

describe('validarRif — inválidos con motivo explicable', () => {
  it('dígito verificador que no cuadra', () => {
    expect(validarRif('J-12345678-5')).toEqual({
      valido: false,
      motivo: 'digito_verificador',
    });
  });
  it('tipo de letra no permitido', () => {
    // X tiene formato correcto ([A-Z]\d{9}) pero no es un tipo válido.
    expect(validarRif('X-12345678-4').motivo).toBe('tipo_invalido');
  });
  it('formato inválido (longitud, caracteres, tipo no string)', () => {
    expect(validarRif('J-1234-4').motivo).toBe('formato_invalido');
    expect(validarRif('J-1234567A-4').motivo).toBe('formato_invalido');
    expect(validarRif('').motivo).toBe('formato_invalido');
    expect(validarRif(null).motivo).toBe('formato_invalido');
    expect(validarRif(12345).motivo).toBe('formato_invalido');
  });
});

describe('validarRif — propiedad de auto-consistencia (fast-check)', () => {
  it('todo RIF generado con su DV calculado es válido', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('V', 'E', 'J', 'P', 'G'),
        fc.stringMatching(/^[0-9]{8}$/),
        (tipo, ocho) => {
          const dv = calcularDigitoVerificadorRif(tipo, ocho);
          const r = validarRif(`${tipo}-${ocho}-${dv}`);
          expect(r.valido).toBe(true);
          expect(r.normalizado).toBe(`${tipo}-${ocho}-${dv}`);
        },
      ),
    );
  });

  it('alterar el DV correcto siempre invalida', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('V', 'E', 'J', 'P', 'G'),
        fc.stringMatching(/^[0-9]{8}$/),
        fc.integer({ min: 1, max: 9 }),
        (tipo, ocho, delta) => {
          const dv = calcularDigitoVerificadorRif(tipo, ocho);
          const dvMalo = (dv + delta) % 10;
          expect(validarRif(`${tipo}-${ocho}-${dvMalo}`).motivo).toBe('digito_verificador');
        },
      ),
    );
  });
});
