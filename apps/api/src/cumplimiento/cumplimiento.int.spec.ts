import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseService } from '../db/database.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ExpedienteService } from './expediente.service';
import { FiscalEventLogService } from './fiscal-event-log.service';
import type { RemisionAdapter } from './remision-adapter';
import { StubRemisionAdapter } from './remision-adapter';
import { RemisionService } from './remision.service';

/**
 * Integración del módulo de cumplimiento (P17, Providencia 121) contra Postgres real (testcontainers):
 * bitácora fiscal encadenada y append-only, aislamiento RLS entre tenants, cola de remisión con
 * reintentos/backoff y acuse, y catálogo global de versiones del producto. Requiere Docker → CI.
 */
describe('Cumplimiento Providencia 121 — integración DB (P17)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let eventos: FiscalEventLogService;
  let remisionStub: RemisionService;
  let expediente: ExpedienteService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: userA, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    database = { db: tdb.appDb } as DatabaseService;
    eventos = new FiscalEventLogService(database);
    remisionStub = new RemisionService(database, new StubRemisionAdapter());
    expediente = new ExpedienteService(database);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userA}, 'a@a.com', 'A')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, tipo_contribuyente, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Empresa A', 'ORDINARIO', false),
      (${companyB}, ${tenantB}, ${rif('J', '00000002')}, 'Empresa B', 'ORDINARIO', false)`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('bitácora: appendea eventos encadenados y la cadena verifica íntegra', async () => {
    await como(tenantA, async () => {
      await eventos.registrarManual({ companyId: companyA, eventType: 'IMPRESION', documentNumber: 'A1' });
      await eventos.registrarManual({ companyId: companyA, eventType: 'REIMPRESION', documentNumber: 'A1' });
      await eventos.registrarManual({ companyId: companyA, eventType: 'FALLO', payload: { motivo: 'impresora sin papel' } });
    });

    const lista = await como(tenantA, () => eventos.listar({}));
    expect(lista).toHaveLength(3);
    // El primero es génesis (prev_hash null); cada siguiente enlaza con el anterior.
    expect(lista[0]?.prevHash).toBeNull();
    expect(lista[1]?.prevHash).toBe(lista[0]?.eventHash);
    expect(lista[2]?.prevHash).toBe(lista[1]?.eventHash);

    const verif = await como(tenantA, () => eventos.verificarCadena());
    expect(verif.ok).toBe(true);
    expect(verif.total).toBe(3);
  });

  it('bitácora: RLS aísla las cadenas entre tenants', async () => {
    await como(tenantB, () => eventos.registrarManual({ companyId: companyB, eventType: 'IMPRESION', documentNumber: 'B1' }));

    const listaB = await como(tenantB, () => eventos.listar({}));
    expect(listaB).toHaveLength(1);
    expect(listaB[0]?.prevHash).toBeNull(); // génesis propio, independiente de A

    // A no ve eventos de B y sigue íntegra.
    const listaA = await como(tenantA, () => eventos.listar({}));
    expect(listaA.every((e) => e.companyId === companyA)).toBe(true);
  });

  it('bitácora: es append-only (rol app sin UPDATE/DELETE; trigger aborta al owner)', async () => {
    await expect(tdb.appSql`update fiscal_event_log set event_type = 'X'`).rejects.toThrow(/permission denied/i);
    await expect(tdb.appSql`delete from fiscal_event_log`).rejects.toThrow(/permission denied/i);
    await expect(tdb.ownerSql`update fiscal_event_log set event_type = 'X' where tenant_id = ${tenantA}`).rejects.toThrow(
      /append-only/i,
    );
    await expect(tdb.ownerSql`delete from fiscal_event_log where tenant_id = ${tenantA}`).rejects.toThrow(/append-only/i);
  });

  it('remisión: el stub deja el ítem PENDIENTE, incrementa reintentos y agenda el próximo intento', async () => {
    const id = await como(tenantA, async () => {
      const fila = await withTenant(database.db, (tx) => remisionStub.encolar(tx, { companyId: companyA, payload: { doc: 'A1' } }));
      return fila.id;
    });

    const resumen = await como(tenantA, () => remisionStub.procesarPendientes());
    expect(resumen.procesados).toBeGreaterThanOrEqual(1);
    expect(resumen.reintentables).toBeGreaterThanOrEqual(1);

    const item = (await como(tenantA, () => remisionStub.listar({}))).find((r) => r.id === id);
    expect(item?.estado).toBe('PENDIENTE');
    expect(item?.reintentos).toBe(1);
    expect(item?.ultimoError).toMatch(/no disponible/i);
    expect(item?.proximoIntento.getTime()).toBeGreaterThan(Date.now());
  });

  it('remisión: un adapter que acusa cierra el ítem como ACUSADO con su constancia', async () => {
    const adapterAcuse: RemisionAdapter = {
      transmitir: async () => ({ tipo: 'ACUSADO', acuseRef: 'SENIAT-AC-001', acuse: { recibido: true } }),
    };
    const remisionOk = new RemisionService(database, adapterAcuse);

    const id = await como(tenantB, async () => {
      const fila = await withTenant(database.db, (tx) => remisionOk.encolar(tx, { companyId: companyB, payload: { doc: 'B1' } }));
      return fila.id;
    });

    const resumen = await como(tenantB, () => remisionOk.procesarPendientes());
    expect(resumen.acusados).toBeGreaterThanOrEqual(1);

    const item = (await como(tenantB, () => remisionOk.listar({}))).find((r) => r.id === id);
    expect(item?.estado).toBe('ACUSADO');
    expect(item?.acuseRef).toBe('SENIAT-AC-001');
    expect(item?.acusadoAt).not.toBeNull();
  });

  it('expediente: incluye la versión sembrada y el informe de los 6 requisitos', async () => {
    const exp = await como(tenantA, () => expediente.generar());
    expect(exp.ficha.versiones.some((v) => v.version === '0.1.0')).toBe(true);
    expect(exp.ficha.versionVigente?.version).toBe('0.1.0');
    expect(exp.cumplimiento.requisitos).toHaveLength(6);
  });
});
