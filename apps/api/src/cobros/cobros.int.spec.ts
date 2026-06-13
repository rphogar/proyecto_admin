import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { cobros } from '../db/schema';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { CobrosService } from './cobros.service';

/**
 * Integración del registro de cobros (P8) contra Postgres real (testcontainers): IGTF percibido en
 * pago mixto (caso 4), diferencial cambiario realizado (caso 6), inmutabilidad del cobro POSTED
 * (regla 4) y aislamiento RLS. Requiere Docker → CI.
 */
describe('Cobros — integración DB (P8)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;
  let cobrosSvc: CobrosService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID(); // SPE → perceptor de IGTF
  const clienteA = randomUUID();
  const ISSUE = '2026-06-12T14:00:00.000Z';

  let pmPagoMovil = '';
  let pmEfectivoUsd = '';
  let pmTransferUsd = ''; // USD sin IGTF (para aislar el diferencial)

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  async function nuevaSerie(): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', '', 1)`;
    return id;
  }

  /** Emite una factura en USD ($100 + IVA) a tasa `rateBcv` y devuelve el documento. */
  async function emitirFacturaUsd(rateBcv: string) {
    const seriesId = await nuevaSerie();
    return como(tenantA, () =>
      emision.emitir({
        companyId: companyA,
        seriesId,
        tipo: 'FACTURA',
        moneda: 'USD',
        rateBcv,
        rateUsdMgmt: rateBcv,
        paymentCondition: 'CONTADO',
        issueDate: ISSUE,
        numeroControl: '00-00000001',
        partyId: clienteA,
        lineas: [{ descripcion: 'Producto', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '0' }],
      }),
    );
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    emision = new EmisionService(database, new AuditService());
    cobrosSvc = new CobrosService(database, new AuditService());

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa SPE C.A.', 'Av. Principal, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    // Métodos de pago mapeados a sus cuentas de caja/banco.
    const cuentas = await tdb.ownerSql<{ id: string; codigo: string }[]>`select id, codigo from accounts where company_id = ${companyA}`;
    const idDe = (codigo: string) => cuentas.find((c) => c.codigo === codigo)!.id;
    pmPagoMovil = randomUUID();
    pmEfectivoUsd = randomUUID();
    pmTransferUsd = randomUUID();
    await tdb.ownerSql`insert into payment_methods (id, tenant_id, company_id, codigo, nombre, moneda, cuenta_id, causa_igtf) values
      (${pmPagoMovil}, ${tenantA}, ${companyA}, 'PAGO_MOVIL', 'Pago Móvil', 'VES', ${idDe('1.1.03')}, false),
      (${pmEfectivoUsd}, ${tenantA}, ${companyA}, 'ZELLE', 'Zelle', 'USD', ${idDe('1.1.05')}, true),
      (${pmTransferUsd}, ${tenantA}, ${companyA}, 'TRANSFERENCIA', 'Transferencia USD local', 'USD', ${idDe('1.1.04')}, false)`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('caso 4 — pago mixto: percibe IGTF $1,80 sobre la porción en divisas y cuadra en 3 bases', async () => {
    const factura = await emitirFacturaUsd('250');
    const res = await como(tenantA, () =>
      cobrosSvc.registrar({
        companyId: companyA,
        documentId: factura.documento.id,
        rateUsdMgmt: '250',
        medios: [
          { paymentMethodId: pmPagoMovil, montoOrigen: '10000', rateBcv: null }, // Bs 10.000 = $40
          { paymentMethodId: pmEfectivoUsd, montoOrigen: '60', rateBcv: '250' }, // $60 Zelle → IGTF
        ],
      }),
    );

    expect(res.cobro.status).toBe('POSTED');
    expect(res.cobro.igtfTotalVes).toBe('450.00000000'); // 1.80 * 250
    expect(res.cobro.journalEntryId).not.toBeNull();
    expect(res.aplicaciones).toHaveLength(1);

    // El asiento del cobro está POSTED, balanceado y acredita IGTF a 2.3.05.
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string }[]>`
      select a.codigo, jl.dc, jl.monto_ves from journal_lines jl
      join accounts a on a.id = jl.account_id where jl.entry_id = ${res.cobro.journalEntryId!}`;
    const igtf = lineas.find((l) => l.codigo === '2.3.05');
    expect(igtf?.dc).toBe('C');
    expect(Number(igtf?.monto_ves)).toBeCloseTo(450, 2);
    const debe = lineas.filter((l) => l.dc === 'D').reduce((s, l) => s + Number(l.monto_ves), 0);
    const haber = lineas.filter((l) => l.dc === 'C').reduce((s, l) => s + Number(l.monto_ves), 0);
    expect(debe).toBeCloseTo(haber, 2);
  });

  it('caso 6 — CxC USD cobrada a tasa mayor: registra ganancia cambiaria (4.7) en VES', async () => {
    const factura = await emitirFacturaUsd('250'); // CxC nace a 250
    const res = await como(tenantA, () =>
      cobrosSvc.registrar({
        companyId: companyA,
        documentId: factura.documento.id,
        rateUsdMgmt: '270',
        medios: [{ paymentMethodId: pmTransferUsd, montoOrigen: '100', rateBcv: '270' }], // sin IGTF, cobra a 270
      }),
    );

    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string; es_ajuste: boolean }[]>`
      select a.codigo, jl.dc, jl.monto_ves, jl.es_ajuste from journal_lines jl
      join accounts a on a.id = jl.account_id where jl.entry_id = ${res.cobro.journalEntryId!}`;
    const ganancia = lineas.find((l) => l.codigo === '4.7');
    expect(ganancia?.dc).toBe('C');
    expect(ganancia?.es_ajuste).toBe(true);
    expect(Number(ganancia?.monto_ves)).toBeCloseTo(2000, 2); // (270 − 250) * 100
  });

  it('inmutabilidad: un cobro POSTED no admite UPDATE (regla 4)', async () => {
    const factura = await emitirFacturaUsd('250');
    const res = await como(tenantA, () =>
      cobrosSvc.registrar({
        companyId: companyA,
        documentId: factura.documento.id,
        rateUsdMgmt: '250',
        medios: [{ paymentMethodId: pmTransferUsd, montoOrigen: '116', rateBcv: '250' }],
      }),
    );
    await expect(
      withTenant(tdb.appDb, (tx) => tx.update(cobros).set({ hashIntegridad: 'editado' }).where(sql`${cobros.id} = ${res.cobro.id}`), tenantA),
    ).rejects.toThrow(/inmutable/i);
  });

  it('aislamiento RLS: el tenant B no ve los cobros del tenant A', async () => {
    const cobrosB = await withTenant(tdb.appDb, (tx) => tx.select().from(cobros), tenantB);
    expect(cobrosB).toHaveLength(0);
  });
});
