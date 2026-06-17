import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import { EmisionService } from './emision.service';

/**
 * Integración de NOTAS DE CRÉDITO (P8) contra Postgres real (testcontainers): asiento de reverso de
 * la venta, imputación al período corriente de la NC (caso 17) y tope del saldo acreditable
 * (caso 18). Requiere Docker → CI.
 */
describe('Notas de crédito — integración DB (P8)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;

  const tenantA = randomUUID();
  const companyA = randomUUID();
  const clienteA = randomUUID();

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantA), fn);
  }

  async function serie(docType: string): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, ${docType}, '', 1)`;
    return id;
  }

  /** Emite una factura USD $100 + IVA 16% ($116) en junio. */
  async function facturaJunio() {
    const seriesId = await serie('FACTURA');
    return como(() =>
      emision.emitir({
        companyId: companyA,
        seriesId,
        tipo: 'FACTURA',
        moneda: 'USD',
        rateBcv: '250',
        rateUsdMgmt: '250',
        paymentCondition: 'CONTADO',
        issueDate: '2026-06-12T14:00:00.000Z',
        numeroControl: '00-00000001',
        partyId: clienteA,
        lineas: [{ descripcion: 'Producto', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
  }

  function ncBody(seriesId: string, afectadaId: string, issueDate: string, precio: string) {
    return {
      companyId: companyA,
      seriesId,
      tipo: 'NOTA_CREDITO',
      moneda: 'USD',
      rateBcv: '250',
      rateUsdMgmt: '250',
      paymentCondition: 'CONTADO',
      issueDate,
      numeroControl: '00-00000050',
      partyId: clienteA,
      affectedDocumentId: afectadaId,
      lineas: [{ descripcion: 'Devolución producto', cantidad: '1', precioUnitarioOrigen: precio, alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
    };
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    emision = new EmisionService(
      database,
      new AuditService(),
      new FiscalEventLogService(database),
      new RemisionService(database, new StubRemisionAdapter()),
    );

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Tenant A', 'tenant-a')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa A C.A.', 'Av. Principal, Caracas')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 7, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('la NC es el reverso de la venta: D Ventas + D IVA débito, C Clientes, balanceado', async () => {
    const factura = await facturaJunio();
    const ncSerie = await serie('NOTA_CREDITO');
    const nc = await como(() => emision.emitir(ncBody(ncSerie, factura.documento.id, '2026-06-20T14:00:00.000Z', '100')));

    expect(nc.documento.status).toBe('ISSUED');
    expect(nc.documento.affectedDocumentId).toBe(factura.documento.id);

    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string }[]>`
      select a.codigo, jl.dc, jl.monto_ves from journal_lines jl
      join accounts a on a.id = jl.account_id where jl.entry_id = ${nc.documento.journalEntryId!}`;
    // Reverso: Ventas (4.1) e IVA débito (2.3.01) al DEBE; Clientes divisas (1.2.02) al HABER.
    expect(lineas.find((l) => l.codigo === '4.1')?.dc).toBe('D');
    expect(lineas.find((l) => l.codigo === '2.3.01')?.dc).toBe('D');
    expect(lineas.find((l) => l.codigo === '1.2.02')?.dc).toBe('C');
    const debe = lineas.filter((l) => l.dc === 'D').reduce((s, l) => s + Number(l.monto_ves), 0);
    const haber = lineas.filter((l) => l.dc === 'C').reduce((s, l) => s + Number(l.monto_ves), 0);
    expect(debe).toBeCloseTo(haber, 2);
  });

  it('caso 17: una NC en julio sobre una factura de junio se imputa al período de la NC (julio)', async () => {
    const factura = await facturaJunio();
    const ncSerie = await serie('NOTA_CREDITO');
    const nc = await como(() => emision.emitir(ncBody(ncSerie, factura.documento.id, '2026-07-05T14:00:00.000Z', '100')));

    expect(nc.documento.issueFechaFiscal.startsWith('2026-07')).toBe(true);
    const [asiento] = await tdb.ownerSql<{ anio: number; mes: number }[]>`
      select p.anio, p.mes from journal_entries je join periods p on p.id = je.period_id
      where je.id = ${nc.documento.journalEntryId!}`;
    expect(asiento?.anio).toBe(2026);
    expect(asiento?.mes).toBe(7); // imputada al período corriente, sin reabrir junio
  });

  it('caso 18: una NC no puede acreditar más que el saldo de la factura', async () => {
    const factura = await facturaJunio();
    const ncSerie = await serie('NOTA_CREDITO');
    // Primera NC total ($116) consume todo el saldo.
    await como(() => emision.emitir(ncBody(ncSerie, factura.documento.id, '2026-06-20T14:00:00.000Z', '100')));
    // Segunda NC sobre la misma factura ya no tiene saldo → rechazada.
    await expect(
      como(() => emision.emitir(ncBody(ncSerie, factura.documento.id, '2026-06-21T14:00:00.000Z', '50'))),
    ).rejects.toThrow(/saldo/i);
  });
});
