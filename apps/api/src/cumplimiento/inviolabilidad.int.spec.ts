import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { documents, journalEntries, journalLines } from '../db/schema';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { type EslabonCadena, verificarCadena } from './cadena-hash';
import { FiscalEventLogService } from './fiscal-event-log.service';
import { RemisionService } from './remision.service';
import { StubRemisionAdapter } from './remision-adapter';

/**
 * Pruebas de inviolabilidad documentadas (P26, Providencia 121 §6.3 req. 1 y 5). Cada escenario
 * intenta vulnerar un invariante "saltando la API" (SQL directo como rol app y como owner) y demuestra
 * que el sistema lo **rechaza** (privilegios + triggers) o lo **detecta** (cadena de hash), y que la
 * numeración no deja huecos bajo alta concurrencia. Es el insumo de inviolabilidad del expediente
 * técnico de homologación. Requiere Postgres real (testcontainers) → CI.
 */
describe('Inviolabilidad — pruebas de homologación (P26)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let emision: EmisionService;
  let eventos: FiscalEventLogService;

  const tenantA = randomUUID();
  const companyA = randomUUID();
  const clienteA = randomUUID();
  const periodoJunio = randomUUID();
  const userA = randomUUID();

  // 2026-06-12 14:00 UTC → 10:00 Caracas → fecha fiscal 2026-06-12, período 2026-06 (OPEN).
  const ISSUE = '2026-06-12T14:00:00.000Z';

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: userA, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  async function nuevaSerie(prefijo = ''): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', ${prefijo}, 1)`;
    return id;
  }
  async function nextNumber(serieId: string): Promise<number> {
    const [row] = await tdb.ownerSql`select next_number from series where id = ${serieId}`;
    return Number(row?.next_number);
  }
  function facturaBody(seriesId: string): Record<string, unknown> {
    return {
      companyId: companyA,
      seriesId,
      tipo: 'FACTURA',
      moneda: 'VES',
      rateUsdMgmt: '40',
      paymentCondition: 'CONTADO',
      issueDate: ISSUE,
      numeroControl: '00-00000001',
      partyId: clienteA,
      lineas: [
        { descripcion: 'Servicio de consultoría', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
    };
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    database = { db: tdb.appDb } as DatabaseService;
    eventos = new FiscalEventLogService(database);
    emision = new EmisionService(
      database,
      new AuditService(),
      eventos,
      new RemisionService(database, new StubRemisionAdapter()),
    );

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Tenant A', 'tenant-a')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userA}, 'a@a.com', 'A')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa A C.A.', 'Av. Principal, Caracas')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${periodoJunio}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('bitácora fiscal encadenada (req. 1): no se altera y se detecta toda manipulación', () => {
    it('el rol de aplicación no puede UPDATE/DELETE la bitácora (sin privilegio)', async () => {
      await como(tenantA, () => eventos.registrarManual({ companyId: companyA, eventType: 'IMPRESION', documentNumber: 'INV-1' }));
      await expect(tdb.appSql`update fiscal_event_log set event_type = 'X'`).rejects.toThrow(/permission denied/i);
      await expect(tdb.appSql`delete from fiscal_event_log`).rejects.toThrow(/permission denied/i);
    });

    it('el trigger aborta UPDATE/DELETE incluso al owner (append-only)', async () => {
      await expect(tdb.ownerSql`update fiscal_event_log set event_type = 'X' where tenant_id = ${tenantA}`).rejects.toThrow(
        /append-only/i,
      );
      await expect(tdb.ownerSql`delete from fiscal_event_log where tenant_id = ${tenantA}`).rejects.toThrow(/append-only/i);
    });

    it('una manipulación del contenido rompe la cadena y verificarCadena la detecta', async () => {
      await como(tenantA, () => eventos.registrarManual({ companyId: companyA, eventType: 'REIMPRESION', documentNumber: 'INV-2' }));

      // La cadena tal como está persistida verifica íntegra.
      const verif = await como(tenantA, () => eventos.verificarCadena());
      expect(verif.ok).toBe(true);
      expect(verif.total).toBeGreaterThanOrEqual(2);

      // Reconstruimos los eslabones reales y simulamos una alteración (lo que un atacante intentaría
      // hacer en la base saltando los triggers): cambiar el tipo de un evento sin recalcular su hash.
      const filas = await tdb.ownerSql<
        {
          prev_hash: string | null;
          tenant_id: string;
          company_id: string;
          document_id: string | null;
          event_type: string;
          document_number: string | null;
          control_number: string | null;
          hash_documento: string | null;
          ts_utc: Date;
          payload: unknown;
          event_hash: string;
        }[]
      >`select prev_hash, tenant_id, company_id, document_id, event_type, document_number, control_number,
               hash_documento, ts_utc, payload, event_hash
          from fiscal_event_log where tenant_id = ${tenantA} order by seq asc`;
      const eslabones: EslabonCadena[] = filas.map((f) => ({
        prevHash: f.prev_hash,
        tenantId: f.tenant_id,
        companyId: f.company_id,
        documentId: f.document_id,
        eventType: f.event_type,
        documentNumber: f.document_number,
        controlNumber: f.control_number,
        hashDocumento: f.hash_documento,
        tsUtc: new Date(f.ts_utc).toISOString(),
        payload: f.payload,
        eventHash: f.event_hash,
      }));
      expect(verificarCadena(eslabones).ok).toBe(true);

      const manipulado = eslabones.map((e, i) => (i === 0 ? { ...e, eventType: 'ANULACION' } : e));
      const deteccion = verificarCadena(manipulado);
      expect(deteccion.ok).toBe(false);
      expect(deteccion.rotoEn).toBe(0);
    });
  });

  describe('documento emitido ISSUED (req. 1): inmutable saltando la API', () => {
    it('rechaza UPDATE y DELETE de un documento ISSUED (owner y rol app)', async () => {
      const serie = await nuevaSerie('D');
      const res = await como(tenantA, () => emision.emitir(facturaBody(serie)));
      const id = res.documento.id;
      expect(res.documento.status).toBe('ISSUED');

      await expect(tdb.ownerSql`update documents set control_number = 'hack' where id = ${id}`).rejects.toThrow(/inmutable/i);
      await expect(tdb.ownerSql`delete from documents where id = ${id}`).rejects.toThrow(/inmutable/i);
      await expect(
        withTenant(tdb.appDb, (tx) => tx.update(documents).set({ controlNumber: 'hack' }).where(sql`${documents.id} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);
    });
  });

  describe('asiento contable POSTED (req. 1): inmutable saltando la API', () => {
    it('rechaza UPDATE/DELETE del asiento POSTED y de sus líneas', async () => {
      const serie = await nuevaSerie('J');
      const res = await como(tenantA, () => emision.emitir(facturaBody(serie)));
      const entryId = res.documento.journalEntryId!;
      expect(entryId).not.toBeNull();

      await expect(tdb.ownerSql`update journal_entries set estado = 'DRAFT' where id = ${entryId}`).rejects.toThrow(/inmutable/i);
      await expect(tdb.ownerSql`delete from journal_entries where id = ${entryId}`).rejects.toThrow(/inmutable/i);
      await expect(
        withTenant(tdb.appDb, (tx) => tx.update(journalEntries).set({ descripcion: 'hack' }).where(sql`${journalEntries.id} = ${entryId}`), tenantA),
      ).rejects.toThrow(/inmutable/i);
      await expect(
        withTenant(tdb.appDb, (tx) => tx.delete(journalLines).where(sql`${journalLines.entryId} = ${entryId}`), tenantA),
      ).rejects.toThrow(/inmutable/i);
    });
  });

  describe('numeración sin huecos bajo concurrencia (req. 5, refuerza caso 21)', () => {
    it('500 emisiones simultáneas en la misma serie → correlativo 1..500 sin huecos ni duplicados', async () => {
      const serie = await nuevaSerie('C');
      const N = 500;

      const resultados = await Promise.all(
        Array.from({ length: N }, () => como(tenantA, () => emision.emitir(facturaBody(serie)))),
      );

      const numeros = resultados.map((r) => r.documento.number!).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      expect(new Set(numeros).size).toBe(N);
      expect(await nextNumber(serie)).toBe(N + 1);
      const [fila] = await tdb.ownerSql<{ count: number }[]>`select count(*)::int as count from documents where series_id = ${serie}`;
      expect(fila?.count).toBe(N);
    }, 300_000);
  });
});
