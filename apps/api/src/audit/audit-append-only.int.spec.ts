import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { runWithTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { AuditService } from './audit.service';

/**
 * audit_events es append-only (regla 5, Providencia 121): se puede insertar y leer, pero NUNCA
 * actualizar ni borrar. Doble candado: el rol app carece de UPDATE/DELETE, y un trigger aborta
 * la mutación incluso para el owner.
 */
describe('audit_events append-only', () => {
  let tdb: TestDatabase;
  const audit = new AuditService();
  const tenantId = randomUUID();

  beforeAll(async () => {
    tdb = await createTestDatabase();
    await tdb.ownerSql`insert into tenants (id, nombre, slug)
      values (${tenantId}, 'Tenant', 'tenant')`;

    // Registrar un evento por la vía real (contexto + transacción de tenant).
    await runWithTenantContext(
      { tenantId, userId: undefined, ip: '127.0.0.1', device: 'vitest' },
      () =>
        withTenant(tdb.appDb, (tx) =>
          audit.registrar(tx, { accion: 'company.create', entidad: 'companies' }),
        ),
    );
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('el evento quedó registrado con ts_utc y ts_caracas', async () => {
    const filas = await tdb.ownerSql<{ accion: string; ts_caracas: string }[]>`
      select accion, ts_caracas from audit_events where tenant_id = ${tenantId}`;
    expect(filas).toHaveLength(1);
    expect(filas[0]?.accion).toBe('company.create');
    expect(filas[0]?.ts_caracas).toMatch(/-04:00$/);
  });

  it('el rol app no puede UPDATE ni DELETE (sin grant)', async () => {
    await expect(tdb.appSql`update audit_events set accion = 'x'`).rejects.toThrow(
      /permission denied/i,
    );
    await expect(tdb.appSql`delete from audit_events`).rejects.toThrow(/permission denied/i);
  });

  it('el trigger aborta la mutación incluso para el owner', async () => {
    await expect(
      tdb.ownerSql`update audit_events set accion = 'x' where tenant_id = ${tenantId}`,
    ).rejects.toThrow(/append-only/i);
    await expect(
      tdb.ownerSql`delete from audit_events where tenant_id = ${tenantId}`,
    ).rejects.toThrow(/append-only/i);
  });
});
