import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import type { DatabaseTx } from '../db/database.service';
import { accounts, journalEntries, journalLines } from '../db/schema';
import { withTenant } from '../tenant/with-tenant';
import { seedPlanDeCuentas } from './seed-plan-cuentas';

/**
 * Integración del ledger (P3) contra Postgres real (testcontainers): seed del plan de cuentas,
 * CHECK diferido de cuadre ΣD=ΣC (regla 7), inmutabilidad de asientos POSTED (regla 4, caso 20),
 * período cerrado (regla 9, caso 42), atomicidad (caso 24) y aislamiento RLS (caso 55).
 */
describe('Ledger — integración DB (P3)', () => {
  let tdb: TestDatabase;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const periodoAbierto = randomUUID(); // 2026-01 OPEN
  const periodoCerrado = randomUUID(); // 2025-12 CLOSED
  let cuentas: Map<string, string>; // codigo → account id (empresa A)

  const FECHA_ENERO = new Date('2026-01-15T12:00:00.000Z');

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'),
      (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social) values
      (${companyA}, ${tenantA}, 'J-000000001', 'Empresa A'),
      (${companyB}, ${tenantB}, 'J-000000002', 'Empresa B')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${periodoAbierto}, ${tenantA}, ${companyA}, 2026, 1, 'OPEN'),
      (${periodoCerrado}, ${tenantA}, ${companyA}, 2025, 12, 'CLOSED')`;

    // Seed del plan de cuentas de la empresa A (bajo RLS) y mapa código→id.
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
    cuentas = await withTenant(
      tdb.appDb,
      async (tx) => {
        const filas = await tx.select({ id: accounts.id, codigo: accounts.codigo }).from(accounts);
        return new Map(filas.map((f) => [f.codigo, f.id]));
      },
      tenantA,
    );
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  /** Inserta un asiento (cabecera + 2 líneas) dentro de la tx actual. */
  async function insertarAsiento(
    tx: DatabaseTx,
    opts: {
      id?: string;
      periodId?: string;
      estado?: 'DRAFT' | 'POSTED';
      vesDebe?: string;
      vesHaber?: string;
    } = {},
  ): Promise<string> {
    const entryId = opts.id ?? randomUUID();
    await tx.insert(journalEntries).values({
      id: entryId,
      tenantId: tenantA,
      companyId: companyA,
      fecha: FECHA_ENERO,
      periodId: opts.periodId ?? periodoAbierto,
      estado: opts.estado ?? 'POSTED',
      descripcion: 'Asiento de prueba',
    });
    await tx.insert(journalLines).values([
      {
        tenantId: tenantA,
        companyId: companyA,
        entryId,
        accountId: cuentas.get('1.1.01')!,
        lineaNo: 1,
        dc: 'D',
        moneda: 'VES',
        montoOrigen: opts.vesDebe ?? '100',
        montoVes: opts.vesDebe ?? '100',
        montoUsdMgmt: '2',
      },
      {
        tenantId: tenantA,
        companyId: companyA,
        entryId,
        accountId: cuentas.get('4.6')!,
        lineaNo: 2,
        dc: 'C',
        moneda: 'VES',
        montoOrigen: opts.vesHaber ?? '100',
        montoVes: opts.vesHaber ?? '100',
        montoUsdMgmt: '2',
      },
    ]);
    return entryId;
  }

  describe('seed del plan de cuentas (docs/03 §2)', () => {
    it('sembró el catálogo base completo con naturaleza y movimiento derivados', async () => {
      expect(cuentas.size).toBeGreaterThanOrEqual(70);
      const [caja] = await withTenant(
        tdb.appDb,
        (tx) =>
          tx
            .select({ naturaleza: accounts.naturaleza, esMovimiento: accounts.esMovimiento, moneda: accounts.moneda })
            .from(accounts)
            .where(sql`${accounts.codigo} = '1.1.02'`),
        tenantA,
      );
      expect(caja?.naturaleza).toBe('ACTIVO');
      expect(caja?.esMovimiento).toBe(true);
      expect(caja?.moneda).toBe('USD');
    });

    it('es idempotente (no duplica al re-sembrar)', async () => {
      const insertadas = await withTenant(
        tdb.appDb,
        (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }),
        tenantA,
      );
      expect(insertadas).toBe(0);
    });
  });

  describe('CHECK diferido de cuadre ΣD=ΣC (regla 7)', () => {
    it('acepta un asiento POSTED balanceado', async () => {
      const id = await withTenant(tdb.appDb, (tx) => insertarAsiento(tx), tenantA);
      const [fila] = await withTenant(
        tdb.appDb,
        (tx) => tx.select({ id: journalEntries.id }).from(journalEntries).where(sql`${journalEntries.id} = ${id}`),
        tenantA,
      );
      expect(fila?.id).toBe(id);
    });

    it('rechaza al COMMIT un asiento POSTED desbalanceado en VES', async () => {
      await expect(
        withTenant(tdb.appDb, (tx) => insertarAsiento(tx, { vesHaber: '99' }), tenantA),
      ).rejects.toThrow(/desbalanceado/i);
    });
  });

  describe('atomicidad — todo o nada (caso 24)', () => {
    it('si el asiento desbalanceado revienta al COMMIT, no persiste ni cabecera ni líneas', async () => {
      const id = randomUUID();
      await expect(
        withTenant(tdb.appDb, (tx) => insertarAsiento(tx, { id, vesHaber: '99' }), tenantA),
      ).rejects.toThrow();
      const filas = await withTenant(
        tdb.appDb,
        (tx) => tx.select({ id: journalEntries.id }).from(journalEntries).where(sql`${journalEntries.id} = ${id}`),
        tenantA,
      );
      expect(filas).toHaveLength(0);
    });
  });

  describe('inmutabilidad de asientos POSTED (regla 4, caso 20)', () => {
    it('rechaza UPDATE y DELETE sobre un asiento POSTED y sobre sus líneas', async () => {
      const id = await withTenant(tdb.appDb, (tx) => insertarAsiento(tx), tenantA);

      await expect(
        withTenant(
          tdb.appDb,
          (tx) => tx.update(journalEntries).set({ descripcion: 'editada' }).where(sql`${journalEntries.id} = ${id}`),
          tenantA,
        ),
      ).rejects.toThrow(/inmutable/i);

      await expect(
        withTenant(tdb.appDb, (tx) => tx.delete(journalEntries).where(sql`${journalEntries.id} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);

      await expect(
        withTenant(
          tdb.appDb,
          (tx) => tx.update(journalLines).set({ montoVes: '101' }).where(sql`${journalLines.entryId} = ${id}`),
          tenantA,
        ),
      ).rejects.toThrow(/inmutable/i);
    });

    it('permite editar un asiento que sigue en DRAFT', async () => {
      const id = await withTenant(tdb.appDb, (tx) => insertarAsiento(tx, { estado: 'DRAFT', vesHaber: '50' }), tenantA);
      // DRAFT desbalanceado se permite (el cuadre solo se exige a POSTED).
      await withTenant(
        tdb.appDb,
        (tx) => tx.update(journalEntries).set({ descripcion: 'corrigiendo borrador' }).where(sql`${journalEntries.id} = ${id}`),
        tenantA,
      );
      const [fila] = await withTenant(
        tdb.appDb,
        (tx) => tx.select({ descripcion: journalEntries.descripcion }).from(journalEntries).where(sql`${journalEntries.id} = ${id}`),
        tenantA,
      );
      expect(fila?.descripcion).toBe('corrigiendo borrador');
    });
  });

  describe('período cerrado (regla 9, caso 42)', () => {
    it('rechaza postear un asiento en un período CERRADO', async () => {
      await expect(
        withTenant(
          tdb.appDb,
          (tx) => insertarAsiento(tx, { periodId: periodoCerrado }),
          tenantA,
        ),
      ).rejects.toThrow(/CERRADO/i);
    });
  });

  describe('aislamiento RLS (caso 55)', () => {
    it('el tenant B no ve las cuentas ni los asientos del tenant A', async () => {
      const cuentasB = await withTenant(tdb.appDb, (tx) => tx.select().from(accounts), tenantB);
      expect(cuentasB).toHaveLength(0);
      const asientosB = await withTenant(tdb.appDb, (tx) => tx.select().from(journalEntries), tenantB);
      expect(asientosB).toHaveLength(0);
    });
  });
});
