import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Decimal } from './decimal-config';
import { Money } from './money';

describe('Money — construcción', () => {
  it('crea desde string y desde Decimal', () => {
    expect(Money.of('100.50', 'VES').aCadenaDecimal()).toBe('100.5');
    expect(Money.of(new Decimal('0.00000001'), 'VES').aCadenaDecimal()).toBe('0.00000001');
  });

  it('acepta number solo si es entero seguro', () => {
    expect(Money.of(100, 'USD').aCadenaDecimal()).toBe('100');
    expect(() => Money.of(100.5, 'USD')).toThrow();
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow();
  });

  it('normaliza la moneda a mayúsculas y rechaza la vacía', () => {
    expect(Money.of('1', 'usd').moneda).toBe('USD');
    expect(() => Money.of('1', '')).toThrow();
    expect(() => Money.of('1', '  ')).toThrow();
  });

  it('rechaza valores no finitos o basura', () => {
    expect(() => Money.of('NaN', 'VES')).toThrow();
    expect(() => Money.of('abc', 'VES')).toThrow();
  });

  it('Money.cero', () => {
    expect(Money.cero('VES').esCero()).toBe(true);
  });
});

describe('Money — aritmética exacta (sin error de float)', () => {
  it('0.1 + 0.2 === 0.3 exacto', () => {
    const r = Money.of('0.1', 'VES').suma(Money.of('0.2', 'VES'));
    expect(r.aCadenaDecimal()).toBe('0.3');
  });

  it('suma, resta, multiplicar, dividir', () => {
    expect(Money.of('10', 'USD').resta(Money.of('3.5', 'USD')).aCadenaDecimal()).toBe('6.5');
    expect(Money.of('2.5', 'USD').multiplicar('3').aCadenaDecimal()).toBe('7.5');
    expect(Money.of('10', 'USD').dividir('4').aCadenaDecimal()).toBe('2.5');
  });

  it('negado y valorAbsoluto', () => {
    expect(Money.of('5', 'VES').negado().aCadenaDecimal()).toBe('-5');
    expect(Money.of('-5', 'VES').valorAbsoluto().aCadenaDecimal()).toBe('5');
  });

  it('división por cero lanza', () => {
    expect(() => Money.of('1', 'VES').dividir('0')).toThrow();
  });
});

describe('Money — invariante de moneda', () => {
  it('sumar monedas distintas lanza', () => {
    expect(() => Money.of('1', 'VES').suma(Money.of('1', 'USD'))).toThrow(/monedas distintas/);
  });
  it('comparar monedas distintas lanza', () => {
    expect(() => Money.of('1', 'VES').mayorQue(Money.of('1', 'USD'))).toThrow();
  });
});

describe('Money — comparaciones', () => {
  const a = Money.of('10.00', 'VES');
  const b = Money.of('10', 'VES');
  const c = Money.of('20', 'VES');
  it('igualdad numérica ignora ceros de cola', () => {
    expect(a.igualA(b)).toBe(true);
  });
  it('orden', () => {
    expect(a.menorQue(c)).toBe(true);
    expect(c.mayorQue(a)).toBe(true);
    expect(a.mayorOIgual(b)).toBe(true);
    expect(a.menorOIgual(b)).toBe(true);
  });
  it('signos', () => {
    expect(Money.of('0', 'VES').esCero()).toBe(true);
    expect(Money.of('1', 'VES').esPositivo()).toBe(true);
    expect(Money.of('-1', 'VES').esNegativo()).toBe(true);
    expect(Money.of('0', 'VES').esPositivo()).toBe(false);
  });
});

describe('Money — redondeo fiscal half-up', () => {
  it('redondea el .5 exacto hacia arriba (away from zero)', () => {
    expect(Money.of('2.345', 'VES').redondearFiscal().aCadenaDecimal()).toBe('2.35');
    expect(Money.of('2.355', 'VES').redondearFiscal().aCadenaDecimal()).toBe('2.36');
    expect(Money.of('-2.345', 'VES').redondearFiscal().aCadenaDecimal()).toBe('-2.35');
  });
  it('redondeo de almacenamiento a 8 decimales', () => {
    expect(Money.of('0.123456785', 'VES').redondearAlmacenamiento().aCadenaDecimal()).toBe(
      '0.12345679',
    );
  });
});

describe('Money — prorratear (sin perder céntimos)', () => {
  it('reparto de IVA de ejemplo cuadra al céntimo', () => {
    // 100.00 en proporción 1:1:1 -> 33.34 / 33.33 / 33.33
    const partes = Money.of('100.00', 'VES').prorratear(['1', '1', '1']);
    expect(partes.map((p) => p.aCadenaDecimal())).toEqual(['33.34', '33.33', '33.33']);
    const total = partes.reduce((a, p) => a.suma(p), Money.cero('VES'));
    expect(total.igualA(Money.of('100', 'VES'))).toBe(true);
  });

  it('reparto proporcional a pesos distintos', () => {
    const partes = Money.of('10.00', 'USD').prorratear(['1', '2', '3']);
    const total = partes.reduce((a, p) => a.suma(p), Money.cero('USD'));
    expect(total.igualA(Money.of('10', 'USD'))).toBe(true);
  });

  it('total negativo (nota de crédito) reparte correctamente', () => {
    const partes = Money.of('-1.00', 'VES').prorratear(['1', '1', '1']);
    const total = partes.reduce((a, p) => a.suma(p), Money.cero('VES'));
    expect(total.igualA(Money.of('-1', 'VES'))).toBe(true);
  });

  it('repartirIgual', () => {
    const partes = Money.of('100', 'VES').repartirIgual(3);
    expect(partes).toHaveLength(3);
    const total = partes.reduce((a, p) => a.suma(p), Money.cero('VES'));
    expect(total.igualA(Money.of('100', 'VES'))).toBe(true);
  });

  it('errores de entrada', () => {
    expect(() => Money.of('1', 'VES').prorratear([])).toThrow();
    expect(() => Money.of('1', 'VES').prorratear(['0', '0'])).toThrow();
    expect(() => Money.of('1', 'VES').prorratear(['-1', '2'])).toThrow();
  });

  it('caso 9 doc 07 — tasa 8 decimales × cantidades, sin descuadre', () => {
    // 1000.00 repartido por pesos con muchos decimales: siempre cuadra exacto.
    const partes = Money.of('1000.00', 'VES').prorratear([
      '36.39450000',
      '36.39450000',
      '0.00010000',
    ]);
    const total = partes.reduce((a, p) => a.suma(p), Money.cero('VES'));
    expect(total.igualA(Money.of('1000', 'VES'))).toBe(true);
  });

  it('property: Σpartes === total y a lo sumo 2 decimales por parte', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }), // total en céntimos
        fc.array(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 12 }),
        (totalCent, pesos) => {
          const total = Money.of(new Decimal(totalCent).div(100), 'VES');
          const partes = total.prorratear(pesos.map(String));
          const suma = partes.reduce((a, p) => a.suma(p), Money.cero('VES'));
          expect(suma.igualA(total.redondearFiscal())).toBe(true);
          for (const p of partes) {
            expect(p.aDecimal().decimalPlaces()).toBeLessThanOrEqual(2);
          }
        },
      ),
    );
  });
});

describe('Money — serialización', () => {
  it('toString incluye la moneda', () => {
    expect(Money.of('100.5', 'VES').toString()).toBe('100.5 VES');
  });
  it('toJSON', () => {
    expect(Money.of('100.5', 'USD').toJSON()).toEqual({ amount: '100.5', currency: 'USD' });
  });
  it('round-trip aCadenaDecimal -> of', () => {
    const m = Money.of('123.45678901', 'VES');
    expect(Money.of(m.aCadenaDecimal(), 'VES').igualA(m)).toBe(true);
  });
});
