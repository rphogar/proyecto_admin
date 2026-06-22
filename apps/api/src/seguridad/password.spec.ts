import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

/**
 * Pruebas del hashing Argon2id (P27). Usan la implementación real `@node-rs/argon2` (rápida con los
 * parámetros por defecto); verifican que el hash no sea el texto plano, sea no determinista (sal) y
 * que la verificación distinga la contraseña correcta de la incorrecta.
 */
describe('password — Argon2id', () => {
  it('el hash no es el texto plano y tiene formato argon2id', async () => {
    const hash = await hashPassword('Contraseña-Segura-123');
    expect(hash).not.toContain('Contraseña-Segura-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('es no determinista (sal aleatoria por hash)', async () => {
    const a = await hashPassword('misma-clave');
    const b = await hashPassword('misma-clave');
    expect(a).not.toBe(b);
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('clave-original');
    expect(await verifyPassword(hash, 'clave-original')).toBe(true);
    expect(await verifyPassword(hash, 'clave-equivocada')).toBe(false);
  });

  it('devuelve false (sin lanzar) ante un hash corrupto', async () => {
    expect(await verifyPassword('no-es-un-hash-argon2', 'lo-que-sea')).toBe(false);
  });
});
