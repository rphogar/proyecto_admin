import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { purchases, retentionsIssued, retentionsReceived } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ComprasService } from './compras.service';
import { RetencionesRecibidasService } from './retenciones-recibidas.service';

/**
 * Integración de compras y retenciones (P9) contra Postgres real (testcontainers): retención de IVA
 * 75% (caso 26) y 100% (caso 27), retención de ISLR con sustraendo (caso 31), comprobante recibido
 * con imputación por período (casos 26/28), inmutabilidad de la compra y del comprobante (regla 4) y
 * aislamiento RLS. Requiere Docker → CI.
 */
describe('Compras y retenciones — integración DB (P9)', () => {
  let tdb: TestDatabase;
  let compras: ComprasService;
  let recibidas: RetencionesRecibidasService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID(); // SPE → agente de retención
  const prov75 = randomUUID(); // proveedor con retención 75%
  const prov100 = randomUUID(); // proveedor con retención 100%
  const provPN = randomUUID(); // persona natural (honorarios ISLR)
  const clienteAgente = randomUUID(); // cliente SPE que nos retiene
  const FECHA = '2026-06-12T14:00:00.000Z';

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    compras = new ComprasService(database, new AuditService());
    recibidas = new RetencionesRecibidasService(database, new AuditService());

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Agente SPE C.A.', 'Av. Principal, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, pct_retencion_iva) values
      (${prov75}, ${tenantA}, ${companyA}, 'proveedor', ${rif('J', '00000003')}, 'Proveedor 75 C.A.', 'ordinario', 75),
      (${prov100}, ${tenantA}, ${companyA}, 'proveedor', ${rif('J', '00000004')}, 'Proveedor 100 C.A.', 'ordinario', 100),
      (${provPN}, ${tenantA}, ${companyA}, 'proveedor', ${rif('V', '00000005')}, 'Juan Perito', 'ordinario', 75)`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, es_agente_retencion_iva, pct_retencion_iva) values
      (${clienteAgente}, ${tenantA}, ${companyA}, 'cliente', ${rif('G', '20000001')}, 'Cliente Agente', 'especial', true, 75)`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('caso 26 — compra a SPE: retiene 75% del IVA, comprobante AAAAMMNNNNNNNN, neto 1.040', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: prov75,
        numeroDocumento: '1234',
        numeroControl: '00-0001',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        lineas: [{ descripcion: 'Mercancía', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );

    expect(res.compra.status).toBe('REGISTERED');
    expect(res.compra.retencionIvaVes).toBe('120.00000000');
    expect(res.retenciones).toHaveLength(1);
    const comp = res.retenciones[0]!;
    expect(comp.tipo).toBe('IVA');
    expect(comp.numeroComprobante).toMatch(/^20260600000\d{3}$/);
    expect(comp.montoVes).toBe('120.00000000');

    // El asiento acredita la retención por enterar (2.3.03) y deja el IVA crédito completo (1.3.01).
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string }[]>`
      select a.codigo, jl.dc, jl.monto_ves from journal_lines jl
      join accounts a on a.id = jl.account_id where jl.entry_id = ${res.compra.journalEntryId!}`;
    expect(lineas.find((l) => l.codigo === '2.3.03')?.dc).toBe('C');
    expect(Number(lineas.find((l) => l.codigo === '1.3.01')?.monto_ves)).toBeCloseTo(160, 2);
    const prov = lineas.find((l) => l.codigo === '2.1' && l.dc === 'C');
    expect(Number(prov?.monto_ves)).toBeCloseTo(1040, 2);
    const debe = lineas.filter((l) => l.dc === 'D').reduce((s, l) => s + Number(l.monto_ves), 0);
    const haber = lineas.filter((l) => l.dc === 'C').reduce((s, l) => s + Number(l.monto_ves), 0);
    expect(debe).toBeCloseTo(haber, 2);
  });

  it('caso 27 — proveedor con retención 100%: comprobante por 160', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: prov100,
        numeroDocumento: '5678',
        numeroControl: '00-0002',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        lineas: [{ descripcion: 'Mercancía', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
    expect(res.compra.retencionIvaVes).toBe('160.00000000');
    expect(res.retenciones[0]!.porcentaje).toBe('100.00');
  });

  it('correlativo del comprobante de IVA es consecutivo dentro del período/tipo', async () => {
    const numeros = await tdb.ownerSql<{ numero_comprobante: string; correlativo: number }[]>`
      select numero_comprobante, correlativo from retentions_issued
      where company_id = ${companyA} and tipo = 'IVA' order by correlativo`;
    const correlativos = numeros.map((n) => n.correlativo);
    expect(correlativos).toEqual([...correlativos].sort((a, b) => a - b));
    // Sin huecos: 1..n.
    correlativos.forEach((c, i) => expect(c).toBe(i + 1));
  });

  it('caso 31 — honorarios a PN: retención ISLR 3% con sustraendo 22,50 → 277,50', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: provPN,
        numeroDocumento: 'H-001',
        numeroControl: '00-0003',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        cuentaDestino: '6.2',
        conceptoIslr: 'Honorarios profesionales',
        tarifaIslr: '3',
        sustraendoIslr: '22.50',
        lineas: [{ descripcion: 'Honorarios', cantidad: '1', precioUnitarioOrigen: '10000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
      }),
    );
    const islr = res.retenciones.find((r) => r.tipo === 'ISLR');
    expect(islr?.montoVes).toBe('277.50000000');
    expect(islr?.conceptoIslr).toBe('Honorarios profesionales');
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string }[]>`
      select a.codigo, jl.dc from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.entry_id = ${res.compra.journalEntryId!}`;
    expect(lineas.find((l) => l.codigo === '2.3.04')?.dc).toBe('C');
  });

  it('caso 29 — factura que no discrimina el IVA: retiene 100% y marca crédito no deducible + alerta', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: prov75, // proveedor 75, pero la factura incumple → 100%
        numeroDocumento: 'ND-029',
        numeroControl: '00-0029',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        discriminaIva: false,
        lineas: [{ descripcion: 'Mercancía', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
    expect(res.compra.retencionIvaVes).toBe('160.00000000'); // 100%
    expect(res.creditoFiscalDeducible).toBe(false);
    expect(res.alertas.join(' ')).toMatch(/no discrimina/i);
  });

  it('caso 32 — pago mixto: retiene ISLR solo sobre la línea de servicio marcada', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: provPN,
        numeroDocumento: 'MIX-032',
        numeroControl: '00-0032',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        cuentaDestino: '6.2',
        conceptoIslr: 'Servicios',
        tarifaIslr: '1',
        // sin baseIslr explícita → se toma de las líneas marcadas (caso 32).
        lineas: [
          { descripcion: 'Mano de obra', cantidad: '1', precioUnitarioOrigen: '3000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', sujetoIslr: true },
          { descripcion: 'Materiales', cantidad: '1', precioUnitarioOrigen: '7000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', sujetoIslr: false },
        ],
      }),
    );
    const islr = res.retenciones.find((r) => r.tipo === 'ISLR');
    // Base 3.000 × 1% = 30 (solo el servicio); materiales fuera de la base.
    expect(islr?.baseVes).toBe('3000.00000000');
    expect(islr?.montoVes).toBe('30.00000000');
  });

  it('tabla 1.808 — resuelve tarifa/sustraendo por concepto+persona (sin pasar tarifa): honorarios PN → 277,50', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: provPN,
        numeroDocumento: 'T1808-1',
        numeroControl: '00-1808',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        cuentaDestino: '6.2',
        conceptoIslrCodigo: '001', // honorarios profesionales
        tipoPersonaIslr: 'PN_RESIDENTE',
        // sin tarifaIslr ni sustraendoIslr: se resuelven de la tabla y la UT (default 9 → sustraendo 22,50).
        lineas: [{ descripcion: 'Honorarios', cantidad: '1', precioUnitarioOrigen: '10000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
      }),
    );
    const islr = res.retenciones.find((r) => r.tipo === 'ISLR');
    expect(islr?.montoVes).toBe('277.50000000');
    expect(islr?.porcentaje).toBe('3.00');
    expect(islr?.sustraendoVes).toBe('22.50000000');
    expect(islr?.conceptoIslr).toBe('Honorarios profesionales');
  });

  it('comprobante recibido (caso 26 lado vendedor / caso 28 imputación): D 1.3.02, C Clientes', async () => {
    const res = await como(tenantA, () =>
      recibidas.registrar({
        companyId: companyA,
        partyId: clienteAgente,
        tipo: 'IVA',
        numeroComprobante: '20260600000099',
        moneda: 'VES',
        rateUsdMgmt: '40',
        baseOrigen: '160',
        porcentaje: '75',
        montoOrigen: '120',
        fechaComprobante: '2026-01-20',
        fechaRecepcion: '2026-06-10', // se imputa en junio (caso 28)
      }),
    );
    expect(res.retencion.periodoMes).toBe(6);
    expect(res.retencion.montoVes).toBe('120.00000000');
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string }[]>`
      select a.codigo, jl.dc, jl.monto_ves from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.entry_id = ${res.retencion.journalEntryId!}`;
    expect(lineas.find((l) => l.codigo === '1.3.02')?.dc).toBe('D');
    expect(lineas.find((l) => l.codigo === '1.2.01')?.dc).toBe('C');
  });

  it('inmutabilidad: una compra REGISTERED no admite UPDATE (regla 4)', async () => {
    const res = await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: prov75,
        numeroDocumento: 'INM-1',
        numeroControl: '00-0004',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: FECHA,
        lineas: [{ descripcion: 'X', cantidad: '1', precioUnitarioOrigen: '500', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
    await expect(
      withTenant(tdb.appDb, (tx) => tx.update(purchases).set({ hashIntegridad: 'editado' }).where(sql`${purchases.id} = ${res.compra.id}`), tenantA),
    ).rejects.toThrow(/inmutable/i);
    // El comprobante también es inmutable.
    await expect(
      withTenant(
        tdb.appDb,
        (tx) => tx.update(retentionsIssued).set({ hashIntegridad: 'x' }).where(sql`${retentionsIssued.purchaseId} = ${res.compra.id}`),
        tenantA,
      ),
    ).rejects.toThrow(/inmutable/i);
  });

  it('aislamiento RLS: el tenant B no ve compras ni retenciones del tenant A', async () => {
    const comprasB = await withTenant(tdb.appDb, (tx) => tx.select().from(purchases), tenantB);
    const recibidasB = await withTenant(tdb.appDb, (tx) => tx.select().from(retentionsReceived), tenantB);
    expect(comprasB).toHaveLength(0);
    expect(recibidasB).toHaveLength(0);
  });
});
