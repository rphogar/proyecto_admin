import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { companies } from '../db/schema';
import { withTenant } from './with-tenant';

/**
 * Caso 55 de docs/07: token/contexto de un tenant usado contra datos de otro → 0 filas (RLS).
 * Verifica el aislamiento real en Postgres con el rol de aplicación SIN BYPASSRLS.
 */
describe('Aislamiento cross-tenant (RLS) — caso 55', () => {
  let tdb: TestDatabase;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    // Setup como owner (superuser → bypassa RLS): dos tenants con una empresa cada uno.
    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'),
      (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social) values
      (${companyA}, ${tenantA}, 'J-000000001', 'Empresa A'),
      (${companyB}, ${tenantB}, 'J-000000002', 'Empresa B')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('el rol de aplicación NO tiene BYPASSRLS', async () => {
    const [row] = await tdb.ownerSql<{ rolbypassrls: boolean }[]>`
      select rolbypassrls from pg_roles where rolname = 'contave_app'`;
    expect(row?.rolbypassrls).toBe(false);
  });

  it('con contexto del tenant A solo se ven las filas de A', async () => {
    const filas = await withTenant(tdb.appDb, (tx) => tx.select().from(companies), tenantA);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.id).toBe(companyA);
    expect(filas[0]?.tenantId).toBe(tenantA);
  });

  it('el id de una empresa de otro tenant devuelve 0 filas', async () => {
    const filas = await withTenant(
      tdb.appDb,
      (tx) => tx.select().from(companies),
      tenantA,
    );
    expect(filas.map((f) => f.id)).not.toContain(companyB);
  });

  it('insertar con tenant_id ajeno al contexto es rechazado (WITH CHECK)', async () => {
    await expect(
      withTenant(
        tdb.appDb,
        (tx) =>
          tx.insert(companies).values({
            tenantId: tenantB, // ≠ contexto (A)
            rif: 'J-000000003',
            razonSocial: 'Intrusa',
          }),
        tenantA,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('sin contexto de tenant no se ve ninguna fila', async () => {
    const filas = await tdb.appSql`select * from companies`;
    expect(filas).toHaveLength(0);
  });
});
