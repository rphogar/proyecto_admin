import { describe, expect, it } from 'vitest';
import { claveJwt, firmarJwt, verificarJwt } from './jwt';

/**
 * Pruebas del JWT HS256 a mano (P27): round-trip, expiración, manipulación de firma/claims y
 * rechazo de `alg:none`/confusión de algoritmo. El instante se inyecta → deterministas.
 */
const CLAVE = Buffer.alloc(32, 9);
const T0 = 1_700_000_000_000; // instante fijo de referencia (ms)

describe('jwt — firma y verificación HS256', () => {
  it('round-trip: lo firmado se verifica y conserva los claims', () => {
    const token = firmarJwt({ sub: 'u1', scope: 'access', rol: 'owner' }, CLAVE, {
      ttlSeg: 900,
      ahoraMs: T0,
    });
    const claims = verificarJwt(token, CLAVE, T0 + 1_000);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('u1');
    expect(claims?.scope).toBe('access');
    expect(claims?.rol).toBe('owner');
    expect(claims?.exp).toBe(Math.floor(T0 / 1000) + 900);
  });

  it('conserva el tenant activo (`tid`) en el round-trip (P28)', () => {
    const tid = '00000000-0000-0000-0000-0000000000a1';
    const token = firmarJwt({ sub: 'u1', scope: 'access', tid }, CLAVE, { ttlSeg: 900, ahoraMs: T0 });
    expect(verificarJwt(token, CLAVE, T0 + 1_000)?.tid).toBe(tid);
  });

  it('devuelve null si el token expiró', () => {
    const token = firmarJwt({ sub: 'u1', scope: 'access' }, CLAVE, { ttlSeg: 60, ahoraMs: T0 });
    expect(verificarJwt(token, CLAVE, T0 + 61_000)).toBeNull();
    // En el límite exacto (exp == ahora) también se considera expirado.
    expect(verificarJwt(token, CLAVE, T0 + 60_000)).toBeNull();
    expect(verificarJwt(token, CLAVE, T0 + 59_000)).not.toBeNull();
  });

  it('rechaza una firma manipulada', () => {
    const token = firmarJwt({ sub: 'u1', scope: 'access' }, CLAVE, { ttlSeg: 900, ahoraMs: T0 });
    const partes = token.split('.');
    const manipulado = `${partes[0]}.${partes[1]}.${'A'.repeat(partes[2]!.length)}`;
    expect(verificarJwt(manipulado, CLAVE, T0)).toBeNull();
  });

  it('rechaza el token firmado con otra clave', () => {
    const token = firmarJwt({ sub: 'u1', scope: 'access' }, CLAVE, { ttlSeg: 900, ahoraMs: T0 });
    expect(verificarJwt(token, Buffer.alloc(32, 1), T0)).toBeNull();
  });

  it('rechaza alg:none y la confusión de algoritmo', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/, '');
    const body = Buffer.from(JSON.stringify({ sub: 'u1', scope: 'access', exp: 9_999_999_999 }))
      .toString('base64')
      .replace(/=+$/, '');
    expect(verificarJwt(`${header}.${body}.`, CLAVE, T0)).toBeNull();
  });

  it('rechaza un token con formato inválido', () => {
    expect(verificarJwt('no-es-un-jwt', CLAVE, T0)).toBeNull();
    expect(verificarJwt('a.b', CLAVE, T0)).toBeNull();
  });
});

describe('jwt — claveJwt', () => {
  it('exige AUTH_JWT_SECRET de al menos 32 bytes', () => {
    expect(() => claveJwt({} as NodeJS.ProcessEnv)).toThrow(/AUTH_JWT_SECRET/);
    expect(() => claveJwt({ AUTH_JWT_SECRET: 'corto' } as NodeJS.ProcessEnv)).toThrow(/32 bytes/);
    expect(claveJwt({ AUTH_JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv).length).toBe(32);
  });
});
