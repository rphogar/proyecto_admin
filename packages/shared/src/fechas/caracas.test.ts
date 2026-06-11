import { describe, expect, it } from 'vitest';
import { caracasAUtc, fechaFiscal, limitesPeriodoMensual, periodoFiscal } from './caracas';

describe('fechaFiscal — corte por hora de Caracas (UTC−4), no por UTC', () => {
  it('un instante del 1.° a las 02:00Z cae en el mes anterior en Caracas', () => {
    // 2026-02-01T02:00Z = 2026-01-31T22:00 en Caracas.
    const ts = '2026-02-01T02:00:00.000Z';
    expect(fechaFiscal(ts)).toBe('2026-01-31');
    expect(periodoFiscal(ts)).toEqual({ anio: 2026, mes: 1 });
  });

  it('un instante del mismo día tras las 04:00Z se mantiene en el día', () => {
    const ts = '2026-02-01T05:00:00.000Z'; // 01:00 Caracas
    expect(fechaFiscal(ts)).toBe('2026-02-01');
    expect(periodoFiscal(ts)).toEqual({ anio: 2026, mes: 2 });
  });

  it('acepta Date y epoch en ms equivalentes', () => {
    const ms = Date.UTC(2026, 1, 1, 2, 0, 0); // 2026-02-01T02:00Z
    expect(fechaFiscal(ms)).toBe('2026-01-31');
    expect(fechaFiscal(new Date(ms))).toBe('2026-01-31');
  });

  it('borde de fin de año (dic → ene en UTC pero aún dic en Caracas)', () => {
    const ts = '2027-01-01T03:00:00.000Z'; // 2026-12-31T23:00 Caracas
    expect(fechaFiscal(ts)).toBe('2026-12-31');
    expect(periodoFiscal(ts)).toEqual({ anio: 2026, mes: 12 });
  });

  it('rechaza instantes inválidos', () => {
    expect(() => fechaFiscal('no-es-fecha')).toThrow();
  });
});

describe('limitesPeriodoMensual — intervalo semiabierto en UTC', () => {
  it('enero 2026: [01-01 04:00Z, 02-01 04:00Z)', () => {
    const { inicioUtc, finUtc } = limitesPeriodoMensual(2026, 1);
    expect(inicioUtc.toISOString()).toBe('2026-01-01T04:00:00.000Z');
    expect(finUtc.toISOString()).toBe('2026-02-01T04:00:00.000Z');
  });

  it('el fin es exclusivo y coincide con el inicio del mes siguiente', () => {
    const ene = limitesPeriodoMensual(2026, 1);
    const feb = limitesPeriodoMensual(2026, 2);
    expect(ene.finUtc.toISOString()).toBe(feb.inicioUtc.toISOString());
  });

  it('diciembre cruza el año correctamente', () => {
    const { finUtc } = limitesPeriodoMensual(2026, 12);
    expect(finUtc.toISOString()).toBe('2027-01-01T04:00:00.000Z');
  });

  it('rechaza meses fuera de rango', () => {
    expect(() => limitesPeriodoMensual(2026, 0)).toThrow();
    expect(() => limitesPeriodoMensual(2026, 13)).toThrow();
  });

  it('los límites son coherentes con periodoFiscal', () => {
    const { inicioUtc, finUtc } = limitesPeriodoMensual(2026, 3);
    expect(periodoFiscal(inicioUtc)).toEqual({ anio: 2026, mes: 3 });
    // Un milisegundo antes del fin sigue siendo marzo; el fin ya es abril.
    expect(periodoFiscal(new Date(finUtc.getTime() - 1))).toEqual({ anio: 2026, mes: 3 });
    expect(periodoFiscal(finUtc)).toEqual({ anio: 2026, mes: 4 });
  });
});

describe('caracasAUtc', () => {
  it('medianoche de Caracas → 04:00Z', () => {
    expect(caracasAUtc('2026-01-01').toISOString()).toBe('2026-01-01T04:00:00.000Z');
  });
  it('hora civil de Caracas → UTC (+4h)', () => {
    expect(caracasAUtc('2026-01-15T08:00').toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });
  it('rechaza fechas inválidas', () => {
    expect(() => caracasAUtc('basura')).toThrow();
  });
});
