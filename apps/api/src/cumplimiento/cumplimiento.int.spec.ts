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
import { RemisionAdapterDePrueba, StubRemisionAdapter } from './remision-adapter';
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

  it('remisión: encolar es idempotente por documento (no duplica la misma fila)', async () => {
    // Documento real (la cola referencia document_id por FK): serie + documento mínimos.
    const seriesId = randomUUID();
    const docId = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo) values
      (${seriesId}, ${tenantA}, ${companyA}, 'FACTURA', 'A')`;
    await tdb.ownerSql`insert into documents (id, tenant_id, company_id, type, series_id, status, issue_date, issue_fecha_fiscal, currency)
      values (${docId}, ${tenantA}, ${companyA}, 'FACTURA', ${seriesId}, 'ISSUED', now(), '2026-01-15', 'VES')`;

    const [primera, segunda] = await como(tenantA, async () => {
      const a = await withTenant(database.db, (tx) => remisionStub.encolar(tx, { companyId: companyA, documentId: docId, payload: { doc: docId } }));
      const b = await withTenant(database.db, (tx) => remisionStub.encolar(tx, { companyId: companyA, documentId: docId, payload: { doc: docId } }));
      return [a, b];
    });

    expect(segunda.id).toBe(primera.id); // misma fila: el segundo encolar devolvió la existente
    expect(primera.idempotencyKey).toBe(docId);
    const delDoc = (await como(tenantA, () => remisionStub.listar({}))).filter((r) => r.documentId === docId);
    expect(delDoc).toHaveLength(1);
  });

  it('remisión: canal asíncrono — transmitir deja ENVIADO y al consultar el acuse cierra ACUSADO', async () => {
    const remisionAsync = new RemisionService(database, new RemisionAdapterDePrueba({ asincrono: true, consultasHastaAcuse: 1 }));

    const id = await como(tenantB, async () => {
      const fila = await withTenant(database.db, (tx) => remisionAsync.encolar(tx, { companyId: companyB, payload: { doc: 'async-1' } }));
      return fila.id;
    });

    // 1er ciclo: el canal acepta el envío (ENVIADO, acuse pendiente).
    const env = await como(tenantB, () => remisionAsync.procesarPendientes());
    expect(env.enviados).toBeGreaterThanOrEqual(1);
    const enviado = (await como(tenantB, () => remisionAsync.listar({}))).find((r) => r.id === id);
    expect(enviado?.estado).toBe('ENVIADO');
    expect(enviado?.refEnvio).not.toBeNull();

    // El backoff de acuse agenda el próximo intento en el futuro; lo adelantamos para el 2º ciclo.
    await tdb.ownerSql`update fiscal_transmission_queue set proximo_intento = now() where id = ${id}`;
    const ack = await como(tenantB, () => remisionAsync.procesarPendientes());
    expect(ack.acusados).toBeGreaterThanOrEqual(1);
    const acusado = (await como(tenantB, () => remisionAsync.listar({}))).find((r) => r.id === id);
    expect(acusado?.estado).toBe('ACUSADO');
    expect(acusado?.acuseRef).toMatch(/^AC-/);
  });

  it('remisión: estadoCola reporta conteos, backlog elegible y antigüedad por empresa', async () => {
    const companyC = randomUUID();
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, tipo_contribuyente, spe) values
      (${companyC}, ${tenantA}, ${rif('J', '00000003')}, 'Empresa C', 'ORDINARIO', false)`;

    await como(tenantA, async () => {
      for (let i = 0; i < 3; i += 1) {
        await withTenant(database.db, (tx) => remisionStub.encolar(tx, { companyId: companyC, payload: { doc: `C${i}` } }));
      }
    });

    const estado = await como(tenantA, () => remisionStub.estadoCola({ companyId: companyC }));
    expect(estado.conteos.pendiente).toBe(3);
    expect(estado.conteos.total).toBe(3);
    expect(estado.pendientesElegibles).toBe(3);
    expect(estado.antiguedadPendienteSegundos).not.toBeNull();
    expect(estado.tasaError).toBe(0);
    expect(Array.isArray(estado.alertas)).toBe(true);
  });

  it('expediente: incluye la versión sembrada y el informe de los 6 requisitos', async () => {
    const exp = await como(tenantA, () => expediente.generar());
    expect(exp.ficha.versiones.some((v) => v.version === '0.1.0')).toBe(true);
    expect(exp.ficha.versionVigente?.version).toBe('0.1.0');
    expect(exp.cumplimiento.requisitos).toHaveLength(6);
    expect(exp.manuales.length).toBeGreaterThan(0);
    expect(exp.pruebasInviolabilidad.length).toBeGreaterThan(0);
    expect(exp.pendientesNoSoftware.length).toBeGreaterThan(0);
  });
});
