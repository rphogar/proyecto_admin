import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { documentLines, documentTaxes, documents, journalEntries } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import { EmisionService } from './emision.service';

/**
 * Integración de la emisión de documentos (P6) contra Postgres real (testcontainers): emisión
 * transaccional (número + documento + líneas + impuestos + asiento + auditoría), numeración
 * consecutiva sin huecos bajo concurrencia de 100 emisiones paralelas (casos 21/53), atomicidad
 * todo-o-nada (caso 24), inmutabilidad de lo emitido (caso 20), bloqueo del validador (00071) y
 * aislamiento RLS (caso 55). Requiere Docker → CI.
 */
describe('Emisión de documentos — integración DB (P6)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;
  let database: DatabaseService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const clienteA = randomUUID();
  const periodoJunio = randomUUID();

  // 2026-06-12 14:00 UTC → 10:00 Caracas → fecha fiscal 2026-06-12, período 2026-06 (OPEN).
  const ISSUE = '2026-06-12T14:00:00.000Z';

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  /** Crea una serie FACTURA nueva (vía owner) y devuelve su id. */
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

  /** Cuerpo de emisión de una factura simple en VES a `clienteA`. */
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
    emision = new EmisionService(
      database,
      new AuditService(),
      new FiscalEventLogService(database),
      new RemisionService(database, new StubRemisionAdapter()),
    );

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa A C.A.', 'Av. Principal, Caracas'),
      (${companyB}, ${tenantB}, ${rif('00000002')}, 'Empresa B C.A.', 'Av. Secundaria, Valencia')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${periodoJunio}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;

    // Plan de cuentas de la empresa A (bajo RLS), necesario para el asiento de la factura.
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('emisión transaccional (docs/05 §4)', () => {
    it('emite una factura ISSUED con número, líneas, impuestos, asiento y auditoría', async () => {
      const serie = await nuevaSerie();
      const res = await como(tenantA, () => emision.emitir(facturaBody(serie)));

      expect(res.documento.status).toBe('ISSUED');
      expect(res.documento.number).toBe(1);
      expect(res.documento.totalVes).toBe('1160.00000000');
      expect(res.documento.partyRif).toBe(rif('00000003'));
      expect(res.documento.hashIntegridad).toMatch(/^[0-9a-f]{64}$/);
      expect(res.lineas).toHaveLength(1);
      expect(res.impuestos).toHaveLength(1);
      expect(res.impuestos[0]?.montoVes).toBe('160.00000000');

      // El asiento quedó POSTED y enlazado al documento.
      expect(res.documento.journalEntryId).not.toBeNull();
      const [asiento] = await tdb.ownerSql`select estado, source_type, source_id from journal_entries
        where id = ${res.documento.journalEntryId!}`;
      expect(asiento?.estado).toBe('POSTED');
      expect(asiento?.source_type).toBe('FACTURA');
      expect(asiento?.source_id).toBe(res.documento.id);

      // Evento de auditoría de la emisión (regla 5).
      const [evento] = await tdb.ownerSql`select accion, entidad from audit_events
        where entidad_id = ${res.documento.id} and accion = 'document.issue'`;
      expect(evento?.accion).toBe('document.issue');

      // El próximo número de la serie avanzó a 2.
      expect(await nextNumber(serie)).toBe(2);
    });
  });

  describe('numeración consecutiva sin huecos bajo concurrencia (casos 21/53)', () => {
    it('100 emisiones paralelas en la misma serie → correlativo 1..100 sin huecos ni duplicados', async () => {
      const serie = await nuevaSerie('C');
      const N = 100;

      const resultados = await Promise.all(
        Array.from({ length: N }, () => como(tenantA, () => emision.emitir(facturaBody(serie)))),
      );

      const numeros = resultados.map((r) => r.documento.number!).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      // Sin duplicados.
      expect(new Set(numeros).size).toBe(N);
      // El contador quedó exactamente en N+1 y hay N documentos persistidos en la serie.
      expect(await nextNumber(serie)).toBe(N + 1);
      const [fila] = await tdb.ownerSql<{ count: number }[]>`select count(*)::int as count from documents where series_id = ${serie}`;
      expect(fila?.count).toBe(N);
    }, 120_000);
  });

  describe('atomicidad todo-o-nada (caso 24: corte de luz a mitad de emisión)', () => {
    it('si un paso posterior falla, no persiste nada y el número NO se consume', async () => {
      const serie = await nuevaSerie('A');
      // Auditoría que revienta DESPUÉS de número+documento+asiento: simula la caída a mitad.
      const auditFalla = new AuditService();
      vi.spyOn(auditFalla, 'registrar').mockRejectedValue(new Error('corte de luz simulado'));
      const emisionFalla = new EmisionService(
        database,
        auditFalla,
        new FiscalEventLogService(database),
        new RemisionService(database, new StubRemisionAdapter()),
      );

      await expect(como(tenantA, () => emisionFalla.emitir(facturaBody(serie)))).rejects.toThrow(/corte de luz/i);

      // Rollback total: número intacto, sin documentos ni asientos huérfanos.
      expect(await nextNumber(serie)).toBe(1);
      const [fila] = await tdb.ownerSql<{ count: number }[]>`select count(*)::int as count from documents where series_id = ${serie}`;
      expect(fila?.count).toBe(0);

      // Y una emisión posterior exitosa toma el número 1 (no quedó hueco).
      const ok = await como(tenantA, () => emision.emitir(facturaBody(serie)));
      expect(ok.documento.number).toBe(1);
    });
  });

  describe('inmutabilidad del documento emitido (regla 4 / Providencia 121, caso 20)', () => {
    it('rechaza UPDATE y DELETE sobre un documento ISSUED y sobre sus líneas', async () => {
      const serie = await nuevaSerie('I');
      const res = await como(tenantA, () => emision.emitir(facturaBody(serie)));
      const id = res.documento.id;

      await expect(
        withTenant(tdb.appDb, (tx) => tx.update(documents).set({ controlNumber: 'editado' }).where(sql`${documents.id} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);

      await expect(
        withTenant(tdb.appDb, (tx) => tx.delete(documents).where(sql`${documents.id} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);

      await expect(
        withTenant(tdb.appDb, (tx) => tx.update(documentLines).set({ descripcion: 'editada' }).where(sql`${documentLines.documentId} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);

      await expect(
        withTenant(tdb.appDb, (tx) => tx.delete(documentTaxes).where(sql`${documentTaxes.documentId} = ${id}`), tenantA),
      ).rejects.toThrow(/inmutable/i);
    });
  });

  describe('validador pre-emisión (00071/00102)', () => {
    it('bloquea la emisión y NO consume número si faltan requisitos (p.ej. número de control)', async () => {
      const serie = await nuevaSerie('V');
      const body = { ...facturaBody(serie), numeroControl: '' };

      await expect(como(tenantA, () => emision.emitir(body))).rejects.toMatchObject({
        response: { incumplimientos: expect.arrayContaining([expect.objectContaining({ codigo: 'SIN_NUMERO_CONTROL' })]) },
      });
      expect(await nextNumber(serie)).toBe(1);
    });
  });

  describe('período cerrado (regla 9, caso 42)', () => {
    it('rechaza emitir con fecha en un mes sin período abierto', async () => {
      const serie = await nuevaSerie('P');
      const body = { ...facturaBody(serie), issueDate: '2026-07-15T14:00:00.000Z' };
      await expect(como(tenantA, () => emision.emitir(body))).rejects.toThrow(/período/i);
      expect(await nextNumber(serie)).toBe(1);
    });
  });

  describe('aislamiento RLS (caso 55)', () => {
    it('el tenant B no ve los documentos del tenant A', async () => {
      const serie = await nuevaSerie('R');
      await como(tenantA, () => emision.emitir(facturaBody(serie)));

      const docsB = await withTenant(tdb.appDb, (tx) => tx.select().from(documents), tenantB);
      expect(docsB).toHaveLength(0);
      const asientosB = await withTenant(tdb.appDb, (tx) => tx.select().from(journalEntries), tenantB);
      expect(asientosB).toHaveLength(0);
    });
  });
});
