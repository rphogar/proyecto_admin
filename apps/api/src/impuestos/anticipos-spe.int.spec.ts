import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif, Decimal } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { CobrosService } from '../cobros/cobros.service';
import type { DatabaseService } from '../db/database.service';
import { taxReturns } from '../db/schema';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import { DeclaracionesService } from './declaraciones.service';
import { LibrosService } from './libros.service';

/**
 * Integración de anticipos de SPE y casos de borde de declaraciones (P21) contra Postgres real
 * (testcontainers). Verifica: (1) el anticipo se calcula sobre los ingresos brutos de la fracción
 * (quincena/semana) tomados del Libro de Ventas, sin duplicar el IGTF percibido (casos 34/35);
 * (2) varias fracciones del mes coexisten y son inmutables al presentarse; (3) una NC de un período ya
 * declarado se imputa al período corriente y NUNCA reabre la declaración presentada (caso 17).
 * Requiere Docker → CI.
 */
describe('Anticipos de SPE y casos de borde (P21)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let emision: EmisionService;
  let cobros: CobrosService;
  let libros: LibrosService;
  let declaraciones: DeclaracionesService;

  const tenantA = randomUUID();
  const companyA = randomUUID(); // SPE
  const clienteVes = randomUUID();
  const clienteUsd = randomUUID();
  let pmUsd: string;
  let f1Junio: string; // factura de junio para afectar con NC en julio (caso 17)

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }
  async function serie(docType: string): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, ${docType}, '', 1)`;
    return id;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    emision = new EmisionService(
      database,
      audit,
      new FiscalEventLogService(database),
      new RemisionService(database, new StubRemisionAdapter()),
    );
    cobros = new CobrosService(database, audit);
    libros = new LibrosService(database);
    declaraciones = new DeclaracionesService(database, libros, audit);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Tenant A', 'tenant-a')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Empresa SPE C.A.', 'Av. Principal, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 7, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, pct_retencion_iva) values
      (${clienteVes}, ${tenantA}, ${companyA}, 'cliente', ${rif('J', '00000003')}, 'Cliente Bs C.A.', 'ordinario', 75),
      (${clienteUsd}, ${tenantA}, ${companyA}, 'cliente', ${rif('J', '00000004')}, 'Cliente USD C.A.', 'ordinario', 75)`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    const [caja] = await tdb.ownerSql<{ id: string }[]>`select id from accounts where company_id = ${companyA} and codigo = '1.1.02'`;
    pmUsd = randomUUID();
    await tdb.ownerSql`insert into payment_methods (id, tenant_id, company_id, codigo, nombre, moneda, cuenta_id, causa_igtf) values
      (${pmUsd}, ${tenantA}, ${companyA}, 'EFECTIVO_USD', 'Efectivo USD', 'USD', ${caja!.id}, true)`;

    // Parámetros de anticipos vigentes (regla 17): IVA 1% quincenal, ISLR 2% semanal.
    await tdb.ownerSql`insert into fiscal_params (id, tenant_id, clave, valor, vigente_desde) values
      (${randomUUID()}, ${tenantA}, 'ANTICIPO_IVA_SPE', ${tdb.ownerSql.json({ porcentaje: '1', cadencia: 'QUINCENAL' })}, '2026-01-01'),
      (${randomUUID()}, ${tenantA}, 'ANTICIPO_ISLR_SPE', ${tdb.ownerSql.json({ porcentaje: '2', cadencia: 'SEMANAL' })}, '2026-01-01')`;

    // ── Mes sintético junio 2026 ──────────────────────────────────────────────
    // Quincena 1 (días 1–15): factura VES base 200.000 (GENERAL 16%) el día 10.
    const fQ1 = '2026-06-10T14:00:00.000Z';
    const f1 = await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fQ1,
        numeroControl: '00-00000001',
        partyId: clienteVes,
        lineas: [{ descripcion: 'Mercancía', cantidad: '1', precioUnitarioOrigen: '200000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );
    f1Junio = f1.documento.id;

    // Quincena 2 (días 16–fin): factura USD base $100 (= Bs 4.000) cobrada en efectivo USD → IGTF.
    const fQ2 = '2026-06-20T14:00:00.000Z';
    const fUsd = await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'USD',
        rateBcv: '40',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fQ2,
        numeroControl: '00-00000002',
        partyId: clienteUsd,
        lineas: [{ descripcion: 'Servicio', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );
    await como(tenantA, () =>
      cobros.registrar({
        companyId: companyA,
        documentId: fUsd.documento.id,
        fecha: fQ2,
        rateUsdMgmt: '40',
        medios: [{ paymentMethodId: pmUsd, montoOrigen: '116', rateBcv: '40' }],
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('anticipo de IVA (quincena 1): base = ingresos brutos del Libro de Ventas × 1%', async () => {
    const b = await como(tenantA, () => declaraciones.anticipoBorrador(companyA, 'ANTICIPO_IVA', 2026, 6, 1));
    expect(b.cadencia).toBe('QUINCENAL');
    expect(b.parametroPorDefecto).toBe(false);
    expect(b.ventana).toEqual({ desde: '2026-06-01', hasta: '2026-06-16' });
    expect(b.ingresosBrutos).toBe('200000.00');
    expect(b.anticipo.anticipoCalculado).toBe('2000.00');
    expect(b.anticipo.anticipoAPagar).toBe('2000.00');
  });

  it('caso 34/35: el anticipo de la quincena 2 NO incluye el IGTF percibido (no se duplica)', async () => {
    const b = await como(tenantA, () => declaraciones.anticipoBorrador(companyA, 'ANTICIPO_IVA', 2026, 6, 2));
    // El cobro USD causó IGTF (> 0), pero vive en `cobros`, no en la base de ingresos.
    const [c] = await tdb.ownerSql<{ igtf: string }[]>`
      select coalesce(sum(igtf_total_ves), 0) as igtf from cobros
      where company_id = ${companyA} and status = 'POSTED'
        and fecha_fiscal >= '2026-06-16' and fecha_fiscal < '2026-07-01'`;
    expect(new Decimal(c!.igtf).gt(0)).toBe(true);
    // La base del anticipo es solo la base de ventas (Bs 4.000), nunca 4.000 + IGTF.
    expect(b.ingresosBrutos).toBe('4000.00');
    expect(new Decimal(b.ingresosBrutos).eq(new Decimal('4000').plus(c!.igtf))).toBe(false);
    expect(b.anticipo.anticipoCalculado).toBe('40.00');
  });

  it('anticipo de ISLR (semanal): usa la cadencia y el porcentaje propios del parámetro', async () => {
    // La factura del día 10 cae en la 2ª semana ([08, 15)); ISLR 2% sobre 200.000 = 4.000.
    const b = await como(tenantA, () => declaraciones.anticipoBorrador(companyA, 'ANTICIPO_ISLR', 2026, 6, 2));
    expect(b.cadencia).toBe('SEMANAL');
    expect(b.ventana).toEqual({ desde: '2026-06-08', hasta: '2026-06-15' });
    expect(b.ingresosBrutos).toBe('200000.00');
    expect(b.anticipo.anticipoCalculado).toBe('4000.00');
  });

  it('presentar dos fracciones del mismo mes coexiste y cada una es inmutable', async () => {
    const q1 = await como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'ANTICIPO_IVA', anio: 2026, mes: 6, subperiodo: 1, numeroDeclaracion: 'ANT-Q1' }));
    const q2 = await como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'ANTICIPO_IVA', anio: 2026, mes: 6, subperiodo: 2, numeroDeclaracion: 'ANT-Q2' }));
    expect(q1.subperiodo).toBe(1);
    expect(q2.subperiodo).toBe(2);
    expect(q1.id).not.toBe(q2.id);

    // No se puede presentar dos veces la misma fracción.
    await expect(
      como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'ANTICIPO_IVA', anio: 2026, mes: 6, subperiodo: 1, numeroDeclaracion: 'dup' })),
    ).rejects.toThrow(/sustitutiva|existe/i);

    // Inmutabilidad del snapshot presentado.
    await expect(
      withTenant(tdb.appDb, (tx) => tx.update(taxReturns).set({ numeroDeclaracion: 'editado' }).where(sql`${taxReturns.id} = ${q1.id}`), tenantA),
    ).rejects.toThrow(/inmutable/i);
  });

  it('caso 17: la NC de un período ya declarado se imputa al corriente y no reabre lo presentado', async () => {
    // Se presenta el IVA de junio (snapshot inmutable).
    const ivaJunio = await como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'IVA', anio: 2026, mes: 6, numeroDeclaracion: 'IVA-06' }));
    const snapJunio = ivaJunio.snapshot as { planilla: { debitoFiscal: string } };
    const debitoJunioPresentado = snapJunio.planilla.debitoFiscal;

    // En julio se emite una NC sobre una factura de junio (GENERAL 16% Bs 1.000).
    await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('NOTA_CREDITO'),
        tipo: 'NOTA_CREDITO',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: '2026-07-05T14:00:00.000Z',
        numeroControl: '00-00000090',
        partyId: clienteVes,
        affectedDocumentId: f1Junio,
        lineas: [{ descripcion: 'Devolución', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );

    // El snapshot de junio NO cambia: re-presentar está bloqueado y el UPDATE directo también.
    await expect(
      como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'IVA', anio: 2026, mes: 6, numeroDeclaracion: 'IVA-06b' })),
    ).rejects.toThrow(/sustitutiva|existe/i);
    const [junioBd] = await tdb.ownerSql<{ snapshot: { planilla: { debitoFiscal: string } } }[]>`
      select snapshot from tax_returns where company_id = ${companyA} and tipo = 'IVA' and periodo_anio = 2026 and periodo_mes = 6`;
    expect(junioBd!.snapshot.planilla.debitoFiscal).toBe(debitoJunioPresentado);

    // La NC aparece en el Libro de Ventas de JULIO (período corriente) con factor −1.
    const lvJulio = await como(tenantA, () => libros.libroVentas(companyA, 2026, 7));
    expect(lvJulio.filas.some((f) => f.tipoDocumento === 'NOTA_CREDITO' && f.factor === -1)).toBe(true);
    // Julio solo tiene la NC (IVA −160): la planilla del período corriente la refleja y cuadra con el libro.
    const planillaJulio = await como(tenantA, () => declaraciones.planillaIva(companyA, 2026, 7));
    expect(planillaJulio.cuadre.debitoCuadra).toBe(true);
    expect(planillaJulio.planilla.debitoFiscal).toBe('-160.00');
  });
});
