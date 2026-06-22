import type { Request } from 'express';
import { beforeAll, describe, expect, it } from 'vitest';
import { claveJwt, firmarJwt } from '../seguridad/jwt';
import { contextoDesdeBearer } from './tenant-context.middleware';

/**
 * Deriva el contexto de tenant/actor SOLO del access JWT verificado (P28). Pruebas puras (sin DB):
 * un Bearer válido produce contexto; cualquier token ausente/!verifica/sin `tid`/de otro `scope` →
 * null (el middleware estricto lo traduce a 401). Garantiza que NO se puede forzar un tenant: el
 * `tid` va firmado, manipularlo invalida la firma.
 */
const TENANT = '00000000-0000-0000-0000-0000000000a1';
const USER = '00000000-0000-0000-0000-0000000000b1';

/** Request mínimo con la cabecera `Authorization` indicada. */
function reqConBearer(token: string | null): Request {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  return { header: (n: string) => headers[n.toLowerCase()] } as unknown as Request;
}

describe('contextoDesdeBearer — tenant/actor desde el JWT', () => {
  beforeAll(() => {
    process.env.AUTH_JWT_SECRET ??= 'x'.repeat(48);
  });

  function firmar(payload: { sub: string; scope: 'access' | '2fa' } & Record<string, unknown>): string {
    return firmarJwt(payload, claveJwt(), { ttlSeg: 900 });
  }

  it('un access válido con tid produce el contexto (minúsculas)', () => {
    const token = firmar({ sub: USER, scope: 'access', tid: TENANT });
    expect(contextoDesdeBearer(reqConBearer(token))).toEqual({ tenantId: TENANT, userId: USER });
  });

  it('sin cabecera Authorization → null', () => {
    expect(contextoDesdeBearer(reqConBearer(null))).toBeNull();
  });

  it('un reto 2FA (scope != access) → null', () => {
    expect(contextoDesdeBearer(reqConBearer(firmar({ sub: USER, scope: '2fa', tid: TENANT })))).toBeNull();
  });

  it('un access sin tid → null (no hay tenant que fijar)', () => {
    expect(contextoDesdeBearer(reqConBearer(firmar({ sub: USER, scope: 'access' })))).toBeNull();
  });

  it('un tid manipulado invalida la firma → null (no se puede forzar tenant)', () => {
    const token = firmar({ sub: USER, scope: 'access', tid: TENANT });
    const [h, , s] = token.split('.');
    const otroBody = Buffer.from(
      JSON.stringify({ sub: USER, scope: 'access', tid: '00000000-0000-0000-0000-0000000000ff', exp: 9_999_999_999 }),
    )
      .toString('base64')
      .replace(/=+$/, '');
    expect(contextoDesdeBearer(reqConBearer(`${h}.${otroBody}.${s}`))).toBeNull();
  });
});
