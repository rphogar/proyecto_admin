import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { CapturaBcvService } from './captura-bcv.service';
import type { DatabaseService } from '../db/database.service';
import { exchangeRates } from '../db/schema';
import { withTenant } from '../tenant/with-tenant';
import type { FuenteTasaBcv, TasaBcvCapturada } from './fuentes/fuente-bcv';

/**
 * Integración de tasas (P4) contra Postgres real (testcontainers): RLS híbrida (global + tenant),
 * resolución "última publicada anterior" (caso 1), idempotencia de la captura (caso 11),
 * corrección del BCV (caso 3) e inmutabilidad append-only (reglas 4/5). Requiere Docker → CI.
 */
describe('Tasas — integración DB (P4)', () => {
  let tdb: TestDatabase;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  /** Fuente falsa parametrizable para ejercitar `CapturaBcvService` contra el PG real. */
  function fuente(tasas: readonly TasaBcvCapturada[]): FuenteTasaBcv {
    return { nombre: 'BCV-test', obtener: async () => tasas };
  }
  function fuenteCaida(): FuenteTasaBcv {
    return {
      nombre: 'BCV-test-fallback',
      obtener: async () => {
        throw new Error('sin fallback');
      },
    };
  }
  function captura(tasas: readonly TasaBcvCapturada[]): CapturaBcvService {
    return new CapturaBcvService({ db: tdb.appDb } as DatabaseService, fuente(tasas), fuenteCaida());
  }
  async function contar(currency: string, rateDate: string): Promise<number> {
    const [row] = await tdb.ownerSql<{ n: number }[]>`
      select count(*)::int as n from exchange_rates
      where currency = ${currency} and rate_date = ${rateDate} and source = 'BCV'`;
    return row?.n ?? 0;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'),
      (${tenantB}, 'Tenant B', 'tenant-b')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('captura BCV: idempotencia y corrección', () => {
    it('caso 11: capturar dos veces la misma tasa NO duplica filas (global, tenant_id NULL)', async () => {
      const tasas: TasaBcvCapturada[] = [{ moneda: 'USD', rate: '36.50000000', publishedAt: null }];
      const r1 = await captura(tasas).capturar('2026-06-10');
      const r2 = await captura(tasas).capturar('2026-06-10');
      expect(r1.insertadas).toBe(1);
      expect(r2.insertadas).toBe(0); // idempotente
      expect(await contar('USD', '2026-06-10')).toBe(1);
    });

    it('caso 3: una tasa distinta el mismo día entra como fila nueva con reemplaza_a + corrección', async () => {
      await captura([{ moneda: 'EUR', rate: '40.00000000', publishedAt: null }]).capturar('2026-06-10');
      const r = await captura([{ moneda: 'EUR', rate: '40.25000000', publishedAt: null }]).capturar('2026-06-10');
      expect(r.correcciones).toBe(1);
      expect(await contar('EUR', '2026-06-10')).toBe(2);
      // La fila corregida apunta a la original (lineage) y la original sigue intacta.
      const filas = await tdb.ownerSql<{ rate: string; reemplaza_a: string | null }[]>`
        select rate, reemplaza_a from exchange_rates
        where currency = 'EUR' and rate_date = '2026-06-10' order by captured_at`;
      expect(filas.map((f) => f.rate)).toEqual(['40.00000000', '40.25000000']);
      expect(filas[0]?.reemplaza_a).toBeNull();
      expect(filas[1]?.reemplaza_a).not.toBeNull();
    });
  });

  describe('resolución rateFor por SQL (caso 1)', () => {
    beforeAll(async () => {
      // Tasas globales BCV: viernes 05 y lunes 08 (fin de semana sin publicación).
      await tdb.ownerSql`insert into exchange_rates (tenant_id, currency, rate, rate_date, source) values
        (null, 'USD', '36.80000000', '2026-06-05', 'BCV'),
        (null, 'USD', '37.10000000', '2026-06-08', 'BCV')`;
    });

    it('un sábado sin tasa resuelve a la última publicada (viernes)', async () => {
      const [fila] = await withTenant(
        tdb.appDb,
        (tx) =>
          tx
            .select({ rate: exchangeRates.rate, rateDate: exchangeRates.rateDate })
            .from(exchangeRates)
            .where(sql`${exchangeRates.currency} = 'USD' and ${exchangeRates.rateDate} <= '2026-06-06'`)
            .orderBy(sql`${exchangeRates.rateDate} desc, ${exchangeRates.capturedAt} desc`)
            .limit(1),
        tenantA,
      );
      expect(fila?.rate).toBe('36.80000000');
      expect(fila?.rateDate).toBe('2026-06-05');
    });
  });

  describe('RLS híbrida (global visible para todos; manual solo del dueño)', () => {
    it('el tenant B ve las tasas globales BCV pero NO las MANUAL del tenant A', async () => {
      await withTenant(
        tdb.appDb,
        (tx) =>
          tx.insert(exchangeRates).values({
            tenantId: tenantA,
            currency: 'USD',
            rate: '37.50000000',
            rateDate: '2026-06-09',
            source: 'MANUAL',
            motivo: 'tasa propia A',
          }),
        tenantA,
      );

      const globalesParaB = await withTenant(
        tdb.appDb,
        (tx) => tx.select().from(exchangeRates).where(sql`${exchangeRates.tenantId} is null`),
        tenantB,
      );
      expect(globalesParaB.length).toBeGreaterThan(0); // ve las BCV globales

      const manualesAjenas = await withTenant(
        tdb.appDb,
        (tx) => tx.select().from(exchangeRates).where(sql`${exchangeRates.source} = 'MANUAL'`),
        tenantB,
      );
      expect(manualesAjenas).toHaveLength(0); // NO ve la MANUAL del tenant A
    });
  });

  describe('inmutabilidad append-only (reglas 4/5)', () => {
    it('rechaza UPDATE y DELETE sobre exchange_rates', async () => {
      await expect(
        withTenant(
          tdb.appDb,
          (tx) => tx.update(exchangeRates).set({ rate: '99' }).where(sql`${exchangeRates.source} = 'MANUAL'`),
          tenantA,
        ),
      ).rejects.toThrow(/append-only/i);

      await expect(
        withTenant(
          tdb.appDb,
          (tx) => tx.delete(exchangeRates).where(sql`${exchangeRates.source} = 'MANUAL'`),
          tenantA,
        ),
      ).rejects.toThrow(/append-only/i);
    });
  });
});
