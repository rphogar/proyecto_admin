import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';

/**
 * fiscal_params no admite vigencias solapadas para una misma (tenant_id, clave) (regla 17):
 * la EXCLUDE constraint con daterange '[)' lo garantiza. Vigencias contiguas (sin solape) sí.
 */
describe('fiscal_params — vigencias sin solape (EXCLUDE)', () => {
  let tdb: TestDatabase;
  const tenantId = randomUUID();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await tdb.ownerSql`insert into tenants (id, nombre, slug)
      values (${tenantId}, 'Tenant', 'tenant')`;
    // Vigencia base de la clave 'UT': [2026-01-01, 2026-07-01).
    await tdb.ownerSql`insert into fiscal_params (tenant_id, clave, valor, vigente_desde, vigente_hasta)
      values (${tenantId}, 'UT', ${tdb.ownerSql.json({ bs: '9.00' })}, '2026-01-01', '2026-07-01')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('rechaza una vigencia que solapa la existente', async () => {
    await expect(
      tdb.ownerSql`insert into fiscal_params (tenant_id, clave, valor, vigente_desde, vigente_hasta)
        values (${tenantId}, 'UT', ${tdb.ownerSql.json({ bs: '20.00' })}, '2026-06-01', null)`,
    ).rejects.toThrow(/fiscal_params_vigencia_no_overlap|exclusion|conflicting/i);
  });

  it('acepta una vigencia contigua (sin solape)', async () => {
    await tdb.ownerSql`insert into fiscal_params (tenant_id, clave, valor, vigente_desde, vigente_hasta)
      values (${tenantId}, 'UT', ${tdb.ownerSql.json({ bs: '20.00' })}, '2026-07-01', null)`;
    const [row] = await tdb.ownerSql<{ n: number }[]>`
      select count(*)::int as n from fiscal_params where tenant_id = ${tenantId} and clave = 'UT'`;
    expect(row?.n).toBe(2);
  });

  it('otra clave puede solapar en el tiempo sin conflicto', async () => {
    await tdb.ownerSql`insert into fiscal_params (tenant_id, clave, valor, vigente_desde, vigente_hasta)
      values (${tenantId}, 'SALARIO_MINIMO', ${tdb.ownerSql.json({ bs: '130.00' })}, '2026-03-01', null)`;
    const [row] = await tdb.ownerSql<{ n: number }[]>`
      select count(*)::int as n from fiscal_params where tenant_id = ${tenantId}`;
    expect(row?.n).toBe(3);
  });
});
