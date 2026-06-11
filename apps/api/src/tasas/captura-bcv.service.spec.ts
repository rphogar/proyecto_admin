import { describe, expect, it, vi } from 'vitest';
import { CapturaBcvService } from './captura-bcv.service';
import type { DatabaseService } from '../db/database.service';
import type { FuenteTasaBcv, TasaBcvCapturada } from './fuentes/fuente-bcv';

const USD: TasaBcvCapturada = { moneda: 'USD', rate: '36.87', publishedAt: null };

function fakeFuente(nombre: string, impl: () => Promise<readonly TasaBcvCapturada[]>): FuenteTasaBcv {
  return { nombre, obtener: impl };
}

/** DatabaseService falso: `transaction` espía; por defecto NO ejecuta el callback (la
 * persistencia se valida en la integración con Postgres real). */
function fakeDb(): { service: DatabaseService; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn(async () => undefined);
  const service = { db: { transaction } } as unknown as DatabaseService;
  return { service, transaction };
}

describe('CapturaBcvService — orquestación primaria/fallback (caso 57)', () => {
  it('usa la fuente primaria cuando responde', async () => {
    const { service, transaction } = fakeDb();
    const primaria = fakeFuente('BCV-web', async () => [USD]);
    const fallback = fakeFuente('BCV-fallback', async () => {
      throw new Error('no debería llamarse');
    });
    const svc = new CapturaBcvService(service, primaria, fallback);

    const r = await svc.capturar('2026-06-09');
    expect(r.status).toBe('capturado');
    expect(r.fuente).toBe('BCV-web');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('cae al fallback si la primaria lanza', async () => {
    const { service } = fakeDb();
    const primaria = fakeFuente('BCV-web', async () => {
      throw new Error('BCV caído');
    });
    const fallback = fakeFuente('BCV-fallback', async () => [USD]);
    const svc = new CapturaBcvService(service, primaria, fallback);

    const r = await svc.capturar('2026-06-09');
    expect(r.status).toBe('capturado');
    expect(r.fuente).toBe('BCV-fallback');
  });

  it('cae al fallback si la primaria responde vacío', async () => {
    const { service } = fakeDb();
    const primaria = fakeFuente('BCV-web', async () => []);
    const fallback = fakeFuente('BCV-fallback', async () => [USD]);
    const svc = new CapturaBcvService(service, primaria, fallback);

    expect((await svc.capturar('2026-06-09')).fuente).toBe('BCV-fallback');
  });

  it('caso 57: si ambas fuentes fallan, no inserta y reporta sin_tasa', async () => {
    const { service, transaction } = fakeDb();
    const primaria = fakeFuente('BCV-web', async () => {
      throw new Error('caído');
    });
    const fallback = fakeFuente('BCV-fallback', async () => {
      throw new Error('caído');
    });
    const svc = new CapturaBcvService(service, primaria, fallback);

    const r = await svc.capturar('2026-06-09');
    expect(r.status).toBe('sin_tasa');
    expect(r.insertadas).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});
