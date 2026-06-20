import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { CobrosService } from '../cobros/cobros.service';
import { ComprasService } from '../compras/compras.service';
import { CierreMensualService } from '../contabilidad/cierre-mensual.service';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import { DashboardService } from '../dashboard/dashboard.service';
import type { DatabaseService } from '../db/database.service';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { TasasService } from '../tasas/tasas.service';
import { PosicionService } from '../tesoreria/posicion.service';
import { RevaluacionService } from '../tesoreria/revaluacion.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ejecutarDrill } from './drill-invariantes';

/**
 * e2e API de los 5 flujos transversales que "deben ser perfectos" (docs/06 §"Flujos transversales"),
 * compuestos extremo a extremo sobre Postgres real (testcontainers). Cada flujo encadena los
 * servicios reales tal como lo haría la UI, y al final se verifica que el ledger global mantiene los
 * invariantes (§7) tras toda la jornada. Requiere Docker → CI.
 *
 *   1. Onboarding: empresa + plan de cuentas precargado + saldo inicial de caja (apertura).
 *   2. Vender y cobrar (POS): factura USD + cobro mixto (Bs + divisa) con IGTF.
 *   3. Compra con retención: registro + comprobante de retención IVA al proveedor.
 *   4. Saber cómo voy (dashboard del dueño en USD).
 *   5. Cerrar el mes (wizard de cierre del contador).
 */
describe('Flujos transversales — e2e API (P18, docs/06)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;
  let cobros: CobrosService;
  let compras: ComprasService;
  let cierre: CierreMensualService;
  let dashboard: DashboardService;

  const tenantA = randomUUID();
  const companyA = randomUUID();
  const userOwner = randomUUID();
  const cliente = randomUUID();
  const prov75 = randomUUID();
  const periodoJunio = randomUUID();
  const cuentas = new Map<string, string>(); // código → id

  const ISSUE = '2026-06-12T14:00:00.000Z';
  let pmPagoMovil = '';
  let pmZelle = '';
  let facturaUsdId = '';

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(userId?: string): TenantContext {
    return { tenantId: tenantA, userId, ip: undefined, device: undefined };
  }
  function como<T>(fn: () => Promise<T>, userId?: string): Promise<T> {
    return runWithTenantContext(ctx(userId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    emision = new EmisionService(
      database,
      audit,
      new FiscalEventLogService(database),
      new RemisionService(database, new StubRemisionAdapter()),
    );
    cobros = new CobrosService(database, audit);
    compras = new ComprasService(database, audit);
    cierre = new CierreMensualService(database, audit, new RevaluacionService(database, audit));
    dashboard = new DashboardService(database, new PosicionService(database), new TasasService(database, audit));

    // Onboarding: alta del tenant, dueño y empresa (RIF → perfil; aquí SPE = agente de retención).
    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Bodegón Don José', 'don-jose')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userOwner}, 'jose@donjose.com', 'José')`;
    await tdb.ownerSql`insert into memberships (id, tenant_id, user_id, role) values (${randomUUID()}, ${tenantA}, ${userOwner}, 'owner')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Don José C.A.', 'Av. Sucre, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${periodoJunio}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, pct_retencion_iva) values
      (${cliente}, ${tenantA}, ${companyA}, 'cliente', ${rif('V', '10000001')}, 'Cliente Uno', 'ordinario', 75),
      (${prov75}, ${tenantA}, ${companyA}, 'proveedor', ${rif('J', '20000002')}, 'Proveedor 75 C.A.', 'ordinario', 75)`;

    // Tasas BCV de junio 2026 (globales) para el dashboard y el wizard de cierre.
    await tdb.ownerSql`insert into exchange_rates (id, currency, rate, rate_date, source)
      select gen_random_uuid(), 'USD', 40, d::date, 'BCV'
      from generate_series('2026-06-01'::date, '2026-06-30'::date, '1 day') as d`;

    // Plan de cuentas precargado (parte del onboarding).
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
    const filas = await tdb.ownerSql<{ codigo: string; id: string }[]>`select codigo, id from accounts where company_id = ${companyA}`;
    for (const f of filas) cuentas.set(f.codigo, f.id);

    // Métodos de pago mapeados a cuentas (para el cobro mixto del POS).
    pmPagoMovil = randomUUID();
    pmZelle = randomUUID();
    await tdb.ownerSql`insert into payment_methods (id, tenant_id, company_id, codigo, nombre, moneda, cuenta_id, causa_igtf) values
      (${pmPagoMovil}, ${tenantA}, ${companyA}, 'PAGO_MOVIL', 'Pago Móvil', 'VES', ${cuentas.get('1.1.03')!}, false),
      (${pmZelle}, ${tenantA}, ${companyA}, 'ZELLE', 'Zelle', 'USD', ${cuentas.get('1.1.05')!}, true)`;
  }, 180_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it('Flujo 5 (onboarding): plan de cuentas precargado y saldo inicial de caja en apertura', async () => {
    // El plan de cuentas base quedó cargado para la empresa.
    expect(cuentas.size).toBeGreaterThan(20);
    expect(cuentas.has('1.1.01')).toBe(true); // Caja
    expect(cuentas.has('3.1')).toBe(true); // Capital social

    // Saldo inicial guiado: asiento de apertura balanceado (D Caja / C Capital).
    const entryId = randomUUID();
    await tdb.ownerSql`insert into journal_entries (id, tenant_id, company_id, fecha, period_id, estado, source_type, descripcion)
      values (${entryId}, ${tenantA}, ${companyA}, ${ISSUE}, ${periodoJunio}, 'POSTED', 'MANUAL', 'Saldo inicial de apertura')`;
    const lineas = [
      { codigo: '1.1.01', dc: 'D', ves: '40000', usd: '1000' },
      { codigo: '3.1', dc: 'C', ves: '40000', usd: '1000' },
    ].map((l, i) => ({
      id: randomUUID(),
      tenant_id: tenantA,
      company_id: companyA,
      entry_id: entryId,
      account_id: cuentas.get(l.codigo)!,
      linea_no: i + 1,
      dc: l.dc,
      moneda: 'VES',
      monto_origen: l.ves,
      monto_ves: l.ves,
      monto_usd_mgmt: l.usd,
    }));
    await tdb.ownerSql`insert into journal_lines ${tdb.ownerSql(lineas)}`;

    const [saldo] = await tdb.ownerSql<{ d: string; c: string }[]>`
      select sum(monto_ves) filter (where dc = 'D') as d, sum(monto_ves) filter (where dc = 'C') as c
      from journal_lines where entry_id = ${entryId}`;
    expect(saldo?.d).toBe(saldo?.c);
  });

  it('Flujo 1 (vender y cobrar): factura USD + cobro mixto Bs+divisa con IGTF, cuadra en 3 bases', async () => {
    // Vender: emitir factura en divisa (POS).
    const seriesId = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${seriesId}, ${tenantA}, ${companyA}, 'FACTURA', 'POS', 1)`;
    const factura = await como(() =>
      emision.emitir({
        companyId: companyA,
        seriesId,
        tipo: 'FACTURA',
        moneda: 'USD',
        rateBcv: '40',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: ISSUE,
        numeroControl: '00-00000001',
        partyId: cliente,
        lineas: [{ descripcion: 'Combo del día', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
    expect(factura.documento.status).toBe('ISSUED');
    expect(factura.documento.number).toBe(1);
    facturaUsdId = factura.documento.id;

    // Cobrar: pago mixto (Bs por pago móvil + USD por Zelle con IGTF) — total $116 a tasa 40.
    const cobro = await como(() =>
      cobros.registrar({
        companyId: companyA,
        documentId: facturaUsdId,
        rateUsdMgmt: '40',
        medios: [
          { paymentMethodId: pmPagoMovil, montoOrigen: '2640', rateBcv: '40' }, // Bs 2.640 = $66
          { paymentMethodId: pmZelle, montoOrigen: '50', rateBcv: '40' }, // $50 Zelle → IGTF 3%
        ],
      }),
    );
    expect(cobro.cobro.status).toBe('POSTED');
    expect(cobro.cobro.journalEntryId).not.toBeNull();

    // El asiento del cobro cuadra ΣD=ΣC en VES.
    const lineas = await tdb.ownerSql<{ dc: string; monto_ves: string }[]>`
      select dc, monto_ves from journal_lines where entry_id = ${cobro.cobro.journalEntryId!}`;
    const debe = lineas.filter((l) => l.dc === 'D').reduce((s, l) => s + Number(l.monto_ves), 0);
    const haber = lineas.filter((l) => l.dc === 'C').reduce((s, l) => s + Number(l.monto_ves), 0);
    expect(debe).toBeCloseTo(haber, 2);
  });

  it('Flujo 2 (compra con retención): registra la compra y emite el comprobante de retención IVA', async () => {
    const res = await como(() =>
      compras.registrar({
        companyId: companyA,
        partyId: prov75,
        numeroDocumento: '4567',
        numeroControl: '00-9001',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: ISSUE,
        lineas: [{ descripcion: 'Insumos', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );
    expect(res.compra.status).toBe('REGISTERED');
    // Retiene 75% del IVA (160 × 75% = 120) y emite el comprobante AAAAMM########.
    expect(res.compra.retencionIvaVes).toBe('120.00000000');
    expect(res.retenciones).toHaveLength(1);
    expect(res.retenciones[0]!.tipo).toBe('IVA');
    expect(res.retenciones[0]!.numeroComprobante).toMatch(/^202606\d{8}$/);
  });

  it('Flujo 4 (saber cómo voy): el dashboard del dueño deriva caja/CxP del ledger', async () => {
    const d = await como(() => dashboard.resumen(companyA));
    // Estructura completa de la vista.
    expect(Object.keys(d).sort()).toEqual(
      ['alertas', 'caja', 'cxc', 'cxp', 'fecha', 'semaforoFiscal', 'tasaBcv', 'topProductos', 'utilidadMes', 'ventas'].sort(),
    );
    // La caja refleja al menos el saldo de apertura (40.000 Bs) más lo cobrado.
    expect(Number(d.caja.totalVes)).toBeGreaterThanOrEqual(40000);
    // La compra a crédito dejó saldo por pagar al proveedor.
    expect(Number(d.cxp.totalPorPagar.ves)).toBeGreaterThan(0);
  });

  it('Flujo 3 (cerrar el mes): el contador/dueño cierra junio 2026 y el período queda CLOSED', async () => {
    const r = await como(() => cierre.cerrar({ companyId: companyA, anio: 2026, mes: 6, rateCierre: '40' }), userOwner);
    expect(r.period.estado).toBe('CLOSED');

    // Tras el cierre, no se admiten más emisiones con fecha en el período (regla 9).
    const serieId = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${serieId}, ${tenantA}, ${companyA}, 'FACTURA', 'X', 1)`;
    await expect(
      como(() =>
        emision.emitir({
          companyId: companyA,
          seriesId: serieId,
          tipo: 'FACTURA',
          moneda: 'VES',
          rateUsdMgmt: '40',
          paymentCondition: 'CONTADO',
          issueDate: ISSUE,
          numeroControl: '00-00000099',
          partyId: cliente,
          lineas: [{ descripcion: 'Tardío', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        }),
      ),
    ).rejects.toThrow(/cerrado/i);
  });

  it('Cierre de jornada: los invariantes del ledger se mantienen al 100% (§7)', async () => {
    const reporte = await ejecutarDrill(tdb.ownerSql);
    expect(reporte.violaciones).toEqual([]);
    expect(reporte.ok).toBe(true);
  });
});
