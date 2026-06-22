import { describe, expect, it } from 'vitest';
import {
  clasificarRefresh,
  generarRefreshToken,
  hashRefreshToken,
  type EstadoRefresh,
} from './tokens-sesion';

/**
 * Pruebas de la lógica pura de refresh tokens (P27): el token opaco no se guarda en claro, el hash
 * es determinista, y la clasificación distingue válido / expirado / reuso (detección de robo).
 */
describe('tokens-sesion — generación y hashing', () => {
  it('genera tokens únicos y el hash es determinista y distinto del valor', () => {
    const a = generarRefreshToken();
    const b = generarRefreshToken();
    expect(a.valor).not.toBe(b.valor);
    expect(a.hash).not.toBe(a.valor);
    expect(hashRefreshToken(a.valor)).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('tokens-sesion — clasificarRefresh', () => {
  const ahora = new Date('2026-06-22T12:00:00Z');
  const base: EstadoRefresh = {
    expiresAt: new Date('2026-06-29T12:00:00Z'),
    revokedAt: null,
    rotatedTo: null,
  };

  it('un token vigente es válido', () => {
    expect(clasificarRefresh(base, ahora).tipo).toBe('valido');
  });

  it('un token fuera de plazo es expirado', () => {
    expect(clasificarRefresh({ ...base, expiresAt: new Date('2026-06-20T12:00:00Z') }, ahora).tipo).toBe(
      'expirado',
    );
  });

  it('un token ya rotado presentado de nuevo es reuso (robo)', () => {
    expect(clasificarRefresh({ ...base, rotatedTo: 'sucesor-id' }, ahora).tipo).toBe('reuso');
  });

  it('un token revocado es reuso', () => {
    expect(clasificarRefresh({ ...base, revokedAt: ahora }, ahora).tipo).toBe('reuso');
  });
});
