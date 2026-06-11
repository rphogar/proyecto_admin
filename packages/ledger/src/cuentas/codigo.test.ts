import { describe, expect, it } from 'vitest';
import {
  claseDeCodigo,
  codigoPadre,
  esAncestro,
  nivelDeCodigo,
  parsearCodigo,
} from './codigo';

describe('código de cuenta C.GG.SS.AAA (docs/03 §2)', () => {
  it('parsea segmentos y tolera espacios', () => {
    expect(parsearCodigo(' 1.1.01 ')).toEqual(['1', '1', '01']);
  });

  it('rechaza códigos vacíos o con segmentos no numéricos', () => {
    expect(() => parsearCodigo('')).toThrow(/vacío/);
    expect(() => parsearCodigo('1.a')).toThrow(/no es numérico/);
    expect(() => parsearCodigo('1..2')).toThrow(/no es numérico/);
  });

  it('deriva nivel, clase y padre', () => {
    expect(nivelDeCodigo('1')).toBe(1);
    expect(nivelDeCodigo('1.1')).toBe(2);
    expect(nivelDeCodigo('1.1.01')).toBe(3);

    expect(claseDeCodigo('1.1.01')).toBe(1);
    expect(claseDeCodigo('4.7')).toBe(4);

    expect(codigoPadre('1.1.01')).toBe('1.1');
    expect(codigoPadre('1.1')).toBe('1');
    expect(codigoPadre('1')).toBeNull();
  });

  it('reconoce ancestros propios por prefijo de segmentos', () => {
    expect(esAncestro('1', '1.1.01')).toBe(true);
    expect(esAncestro('1.1', '1.1.01')).toBe(true);
    expect(esAncestro('1.1.01', '1.1.01')).toBe(false); // no es ancestro propio de sí misma
    expect(esAncestro('1.2', '1.1.01')).toBe(false);
    // prefijo numérico distinto: '1.1' no es ancestro de '1.10' (segmento '1' ≠ '10')
    expect(esAncestro('1.1', '1.10')).toBe(false);
  });
});
