import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrar, claveMaestra, descifrar } from './cifrado';

describe('Cifrado de columnas sensibles (AES-256-GCM)', () => {
  const clave = randomBytes(32);

  it('round-trip cifra y descifra', () => {
    const secreto = 'GEZDGNBVGY3TQOJQ';
    const token = cifrar(secreto, clave);
    expect(token).toMatch(/^v1:/);
    expect(token).not.toContain(secreto);
    expect(descifrar(token, clave)).toBe(secreto);
  });

  it('cada cifrado usa IV aleatorio (tokens distintos para el mismo plano)', () => {
    expect(cifrar('x', clave)).not.toBe(cifrar('x', clave));
  });

  it('detecta manipulación del ciphertext (tag GCM)', () => {
    const token = cifrar('secreto', clave);
    const partes = token.split(':');
    const ctCorrupto = Buffer.from(partes[3]!, 'base64');
    ctCorrupto[0] = (ctCorrupto[0] ?? 0) ^ 0xff;
    partes[3] = ctCorrupto.toString('base64');
    expect(() => descifrar(partes.join(':'), clave)).toThrow();
  });

  it('una clave distinta no descifra', () => {
    const token = cifrar('secreto', clave);
    expect(() => descifrar(token, randomBytes(32))).toThrow();
  });

  it('rechaza formato/versión inválida', () => {
    expect(() => descifrar('v2:a:b:c', clave)).toThrow();
    expect(() => descifrar('basura', clave)).toThrow();
  });

  it('claveMaestra exige 32 bytes y lee hex o base64', () => {
    expect(() => claveMaestra({} as NodeJS.ProcessEnv)).toThrow(/APP_ENCRYPTION_KEY/);
    const hex = randomBytes(32).toString('hex');
    expect(claveMaestra({ APP_ENCRYPTION_KEY: hex } as unknown as NodeJS.ProcessEnv).length).toBe(32);
    const b64 = randomBytes(32).toString('base64');
    expect(claveMaestra({ APP_ENCRYPTION_KEY: b64 } as unknown as NodeJS.ProcessEnv).length).toBe(32);
    const corta = randomBytes(16).toString('base64');
    expect(() => claveMaestra({ APP_ENCRYPTION_KEY: corta } as unknown as NodeJS.ProcessEnv)).toThrow(
      /32 bytes/,
    );
  });
});
