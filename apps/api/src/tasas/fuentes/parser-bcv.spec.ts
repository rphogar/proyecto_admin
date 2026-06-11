import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizarNumeroVe, parsearTasasBcv } from './parser-bcv';

const HTML = readFileSync(resolve(__dirname, '__fixtures__/bcv-ejemplo.html'), 'utf8');

describe('parsearTasasBcv — HTML del BCV (fixture)', () => {
  it('extrae USD y EUR con su precisión de 8 decimales', () => {
    const tasas = parsearTasasBcv(HTML);
    const usd = tasas.find((t) => t.moneda === 'USD');
    const eur = tasas.find((t) => t.moneda === 'EUR');
    expect(usd?.rate).toBe('36.8734');
    expect(eur?.rate).toBe('40.12345678');
  });

  it('captura la fecha de valor publicada', () => {
    const usd = parsearTasasBcv(HTML).find((t) => t.moneda === 'USD');
    // 'Fecha Valor: Lunes, 09 Junio 2026' → 2026-06-09 (mediodía Caracas).
    expect(usd?.publishedAt?.toISOString()).toBe('2026-06-09T16:00:00.000Z');
  });

  it('solo devuelve USD/EUR (ignora yuan/lira/rublo del portal)', () => {
    const monedas = parsearTasasBcv(HTML).map((t) => t.moneda);
    expect(monedas.sort()).toEqual(['EUR', 'USD']);
  });

  it('lanza si el HTML no contiene ninguna tasa', () => {
    expect(() => parsearTasasBcv('<html><body>sin tasas</body></html>')).toThrow(/ninguna tasa/i);
  });
});

describe('normalizarNumeroVe — formato venezolano (coma decimal)', () => {
  it('convierte coma decimal a punto', () => {
    expect(normalizarNumeroVe('36,87340000')).toBe('36.8734');
  });

  it('quita separador de miles', () => {
    expect(normalizarNumeroVe('1.234,56')).toBe('1234.56');
  });

  it('rechaza valores no positivos o ilegibles', () => {
    expect(() => normalizarNumeroVe('0,00')).toThrow();
    expect(() => normalizarNumeroVe('abc')).toThrow();
  });
});
