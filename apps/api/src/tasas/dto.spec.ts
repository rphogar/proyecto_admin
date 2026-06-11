import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parsearTasaManual, validarFecha, validarMoneda, validarRate } from './dto';

describe('validarMoneda', () => {
  it('acepta USD/EUR (normaliza mayúsculas)', () => {
    expect(validarMoneda('usd')).toBe('USD');
    expect(validarMoneda('EUR')).toBe('EUR');
  });
  it('rechaza monedas no soportadas', () => {
    expect(() => validarMoneda('USDT')).toThrow(BadRequestException);
  });
});

describe('validarRate', () => {
  it('normaliza Decimal-string positivo', () => {
    expect(validarRate('36.50000000')).toBe('36.5');
  });
  it('rechaza no positivos o no numéricos (regla 1)', () => {
    expect(() => validarRate('0')).toThrow(BadRequestException);
    expect(() => validarRate('-1')).toThrow(BadRequestException);
    expect(() => validarRate('abc')).toThrow(BadRequestException);
  });
});

describe('validarFecha', () => {
  it('acepta YYYY-MM-DD', () => {
    expect(validarFecha('2026-06-09')).toBe('2026-06-09');
  });
  it('rechaza formatos inválidos', () => {
    expect(() => validarFecha('09/06/2026')).toThrow(BadRequestException);
  });
});

describe('parsearTasaManual', () => {
  it('exige motivo (entrada auditada, regla 5)', () => {
    expect(() =>
      parsearTasaManual({ moneda: 'USD', rate: '36.5', rateDate: '2026-06-09' }),
    ).toThrow(/motivo/i);
  });
  it('parsea una entrada válida', () => {
    expect(
      parsearTasaManual({ moneda: 'usd', rate: '36.50', rateDate: '2026-06-09', motivo: 'BCV caído' }),
    ).toEqual({ moneda: 'USD', rate: '36.5', rateDate: '2026-06-09', motivo: 'BCV caído' });
  });
});
