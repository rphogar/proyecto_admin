import { describe, expect, it } from 'vitest';
import {
  codificarBase32,
  decodificarBase32,
  generarSecreto,
  hotp,
  totp,
  uriOtpauth,
  verificarTotp,
} from './totp';

/**
 * Golden tests del motor TOTP contra los vectores de referencia del RFC 4226 (Apéndice D) y
 * RFC 6238 (Apéndice B). El secreto de referencia es el ASCII "12345678901234567890" (20 bytes).
 */
const SECRETO_SHA1 = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP — vectores RFC 4226 (Apéndice D, 6 dígitos)', () => {
  // Tabla oficial: HOTP(secreto, contador) para contador 0..9.
  const esperados = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it.each(esperados.map((codigo, contador) => ({ contador, codigo })))(
    'HOTP(C=$contador) = $codigo',
    ({ contador, codigo }) => {
      expect(hotp(SECRETO_SHA1, contador, { digitos: 6 })).toBe(codigo);
    },
  );
});

describe('TOTP — vectores RFC 6238 (Apéndice B, 8 dígitos, SHA1)', () => {
  // T (segundos epoch) → TOTP de 8 dígitos con paso 30.
  const vectores: { tSeg: number; codigo: string }[] = [
    { tSeg: 59, codigo: '94287082' },
    { tSeg: 1111111109, codigo: '07081804' },
    { tSeg: 1111111111, codigo: '14050471' },
    { tSeg: 1234567890, codigo: '89005924' },
    { tSeg: 2000000000, codigo: '69279037' },
    { tSeg: 20000000000, codigo: '65353130' },
  ];
  it.each(vectores)('TOTP(T=$tSeg s) = $codigo', ({ tSeg, codigo }) => {
    expect(totp(SECRETO_SHA1, tSeg * 1000, { digitos: 8 })).toBe(codigo);
  });
});

describe('verificarTotp — ventana de tolerancia', () => {
  const T = 1234567890 * 1000;

  it('acepta el código del paso actual', () => {
    const codigo = totp(SECRETO_SHA1, T, { digitos: 8 });
    expect(verificarTotp(SECRETO_SHA1, codigo, T, 1, { digitos: 8 })).toBe(true);
  });

  it('acepta el código del paso anterior y siguiente con ventana ±1', () => {
    const anterior = totp(SECRETO_SHA1, T - 30_000, { digitos: 8 });
    const siguiente = totp(SECRETO_SHA1, T + 30_000, { digitos: 8 });
    expect(verificarTotp(SECRETO_SHA1, anterior, T, 1, { digitos: 8 })).toBe(true);
    expect(verificarTotp(SECRETO_SHA1, siguiente, T, 1, { digitos: 8 })).toBe(true);
  });

  it('rechaza un código fuera de la ventana', () => {
    const lejano = totp(SECRETO_SHA1, T - 90_000, { digitos: 8 });
    expect(verificarTotp(SECRETO_SHA1, lejano, T, 1, { digitos: 8 })).toBe(false);
  });

  it('rechaza códigos con longitud o formato inválido sin lanzar', () => {
    expect(verificarTotp(SECRETO_SHA1, '123', T, 1, { digitos: 8 })).toBe(false);
    expect(verificarTotp(SECRETO_SHA1, 'abcdefgh', T, 1, { digitos: 8 })).toBe(false);
    expect(verificarTotp(SECRETO_SHA1, '', T, 1, { digitos: 8 })).toBe(false);
  });

  it('tolera espacios alrededor del código', () => {
    const codigo = totp(SECRETO_SHA1, T, { digitos: 6 });
    expect(verificarTotp(SECRETO_SHA1, `  ${codigo}  `, T, 1)).toBe(true);
  });
});

describe('Base32 (RFC 4648)', () => {
  it('round-trip de un secreto aleatorio', () => {
    const { secreto, base32 } = generarSecreto();
    expect(base32).toMatch(/^[A-Z2-7]+$/);
    expect(decodificarBase32(base32).equals(secreto)).toBe(true);
  });

  it('codifica el secreto de referencia de forma estable', () => {
    // "12345678901234567890" → vector conocido del ecosistema TOTP.
    expect(codificarBase32(SECRETO_SHA1)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('decodifica tolerando minúsculas, espacios y relleno', () => {
    // "1234567890" (10 bytes) → "GEZDGNBVGY3TQOJQ" (16 chars).
    expect(
      decodificarBase32('gezd gnbv gy3t qojq ==').equals(Buffer.from('1234567890', 'ascii')),
    ).toBe(true);
  });
});

describe('uriOtpauth', () => {
  it('arma un URI otpauth válido con emisor y cuenta codificados', () => {
    const uri = uriOtpauth('GEZDGNBV', 'ContaVE', 'ana@empresa.com');
    expect(uri).toContain('otpauth://totp/ContaVE:ana%40empresa.com');
    expect(uri).toContain('secret=GEZDGNBV');
    expect(uri).toContain('issuer=ContaVE');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
