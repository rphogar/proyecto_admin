import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif, Decimal } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { CobrosService } from '../cobros/cobros.service';
import { ComprasService } from '../compras/compras.service';
import { RetencionesRecibidasService } from '../compras/retenciones-recibidas.service';
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
import { generarLibroExcel } from './export/libro-excel';
import { generarLibroPdf } from './export/libro-pdf';
import { LibrosService } from './libros.service';

/**
 * Integración de Libros y Declaraciones (P10) contra Postgres real (testcontainers). Construye un mes
 * sintético completo (ventas multi-alícuota + NC, compra con retención de IVA, retención soportada
 * recibida e IGTF percibido) y verifica el invariante de **triple igualdad** (docs/05 §7.3): el
 * Libro de Ventas ≡ los documentos persistidos ≡ la planilla de IVA. Además: la planilla cuadra con
 * el Libro de Compras, la declaración de IGTF cuadra con los cobros, y la declaración presentada es
 * inmutable (Providencia 121). Requiere Docker → CI.
 */
describe('Libros y declaraciones — triple igualdad (P10)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let emision: EmisionService;
  let compras: ComprasService;
  let recibidas: RetencionesRecibidasService;
  let cobros: CobrosService;
  let libros: LibrosService;
  let declaraciones: DeclaracionesService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID(); // SPE → agente de retención y perceptor de IGTF
  const clienteVes = randomUUID();
  const clienteUsd = randomUUID();
  const proveedor = randomUUID();
  const clienteAgente = randomUUID();
  let pmUsd: string; // método de pago USD efectivo (causa IGTF)

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
    compras = new ComprasService(database, audit);
    recibidas = new RetencionesRecibidasService(database, audit);
    cobros = new CobrosService(database, audit);
    libros = new LibrosService(database);
    declaraciones = new DeclaracionesService(database, libros, audit);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Empresa SPE C.A.', 'Av. Principal, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 7, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, pct_retencion_iva) values
      (${clienteVes}, ${tenantA}, ${companyA}, 'cliente', ${rif('J', '00000003')}, 'Cliente Bs C.A.', 'ordinario', 75),
      (${clienteUsd}, ${tenantA}, ${companyA}, 'cliente', ${rif('J', '00000004')}, 'Cliente USD C.A.', 'ordinario', 75),
      (${proveedor}, ${tenantA}, ${companyA}, 'proveedor', ${rif('J', '00000005')}, 'Proveedor C.A.', 'ordinario', 75)`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, es_agente_retencion_iva, pct_retencion_iva) values
      (${clienteAgente}, ${tenantA}, ${companyA}, 'cliente', ${rif('G', '20000001')}, 'Cliente Agente', 'especial', true, 75)`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    // Método de pago USD efectivo (causa IGTF), mapeado a "Caja USD efectivo" (1.1.02).
    const [caja] = await tdb.ownerSql<{ id: string }[]>`select id from accounts where company_id = ${companyA} and codigo = '1.1.02'`;
    pmUsd = randomUUID();
    await tdb.ownerSql`insert into payment_methods (id, tenant_id, company_id, codigo, nombre, moneda, cuenta_id, causa_igtf) values
      (${pmUsd}, ${tenantA}, ${companyA}, 'EFECTIVO_USD', 'Efectivo USD', 'USD', ${caja!.id}, true)`;

    // ── Mes sintético: junio 2026 ────────────────────────────────────────────────
    const fF = '2026-06-12T14:00:00.000Z'; // → fecha fiscal 2026-06-12 (Caracas)
    // F1: GENERAL 16% (10.000), REDUCIDA 8% (2.000), EXENTO (1.000).
    const f1 = await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fF,
        numeroControl: '00-00000001',
        partyId: clienteVes,
        lineas: [
          { descripcion: 'Mercancía gravada', cantidad: '1', precioUnitarioOrigen: '10000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
          { descripcion: 'Alimento reducida', cantidad: '1', precioUnitarioOrigen: '2000', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
          { descripcion: 'Libro exento', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
        ],
      } as Record<string, unknown>),
    );
    // F2: GENERAL 16% (5.000).
    await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fF,
        numeroControl: '00-00000002',
        partyId: clienteVes,
        lineas: [{ descripcion: 'Mercancía', cantidad: '1', precioUnitarioOrigen: '5000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );
    // NC1 sobre F1: GENERAL 16% (1.000) → resta del neto del período.
    await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('NOTA_CREDITO'),
        tipo: 'NOTA_CREDITO',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fF,
        numeroControl: '00-00000050',
        partyId: clienteVes,
        affectedDocumentId: f1.documento.id,
        lineas: [{ descripcion: 'Devolución', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );

    // F3: ADICIONAL 31% (1.000 → IVA 310) + EXONERADO (500). Operación interna.
    await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fF,
        numeroControl: '00-00000004',
        partyId: clienteVes,
        lineas: [
          { descripcion: 'Bien suntuario', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'ADICIONAL', alicuotaTasa: '31' },
          { descripcion: 'Bien exonerado', cantidad: '1', precioUnitarioOrigen: '500', alicuotaCodigo: 'EXONERADO', alicuotaTasa: '0' },
        ],
      } as Record<string, unknown>),
    );
    // F4: EXPORTACION 0% (2.000) → operación de exportación (derivada de la alícuota).
    await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'VES',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fF,
        numeroControl: '00-00000005',
        partyId: clienteUsd,
        lineas: [{ descripcion: 'Exportación de bienes', cantidad: '1', precioUnitarioOrigen: '2000', alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '0' }],
      } as Record<string, unknown>),
    );

    // Compra C1: GENERAL 16% (8.000) → crédito fiscal 1.280; SPE retiene 75%. Operación interna.
    await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: proveedor,
        numeroDocumento: 'F-9001',
        numeroControl: '11-0001',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: fF,
        lineas: [{ descripcion: 'Insumos', cantidad: '1', precioUnitarioOrigen: '8000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );

    // Compra C2: IMPORTACION GENERAL 16% (3.000 → crédito 480), con comprobante de retención emitido.
    await como(tenantA, () =>
      compras.registrar({
        companyId: companyA,
        partyId: proveedor,
        tipoOperacion: 'IMPORTACION',
        numeroDocumento: 'F-IMP-002',
        numeroControl: '11-0002',
        moneda: 'VES',
        rateUsdMgmt: '40',
        fechaDocumento: fF,
        lineas: [{ descripcion: 'Mercancía importada', cantidad: '1', precioUnitarioOrigen: '3000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    );

    // Retención de IVA soportada recibida (nos retuvo el cliente agente): 300 imputada a junio.
    await como(tenantA, () =>
      recibidas.registrar({
        companyId: companyA,
        partyId: clienteAgente,
        tipo: 'IVA',
        numeroComprobante: '20260600000077',
        moneda: 'VES',
        rateUsdMgmt: '40',
        baseOrigen: '400',
        porcentaje: '75',
        montoOrigen: '300',
        fechaComprobante: '2026-06-15',
        fechaRecepcion: '2026-06-20',
      }),
    );

    // ── IGTF: factura USD en julio cobrada en efectivo USD (causa percepción) ────
    const fJul = '2026-07-10T14:00:00.000Z';
    const fUsd = await como(tenantA, async () =>
      emision.emitir({
        companyId: companyA,
        seriesId: await serie('FACTURA'),
        tipo: 'FACTURA',
        moneda: 'USD',
        rateBcv: '40',
        rateUsdMgmt: '40',
        paymentCondition: 'CONTADO',
        issueDate: fJul,
        numeroControl: '00-00000003',
        partyId: clienteUsd,
        lineas: [{ descripcion: 'Servicio', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      } as Record<string, unknown>),
    );
    await como(tenantA, () =>
      cobros.registrar({
        companyId: companyA,
        documentId: fUsd.documento.id,
        fecha: fJul,
        rateUsdMgmt: '40',
        medios: [{ paymentMethodId: pmUsd, montoOrigen: '116', rateBcv: '40' }],
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('Libro de Ventas de junio: neto por alícuota (todas), con la NC restada y columnas exactas', async () => {
    const lv = await como(tenantA, () => libros.libroVentas(companyA, 2026, 6));
    // Grupos ordenados por tasa desc: ADICIONAL 31, GENERAL 16, REDUCIDA 8.
    expect(lv.resumen.grupos).toEqual([
      { alicuotaCodigo: 'ADICIONAL', alicuotaTasa: '31', base: '1000.00', monto: '310.00' },
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '14000.00', monto: '2240.00' },
      { alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8', base: '2000.00', monto: '160.00' },
    ]);
    expect(lv.resumen.ivaTotal).toBe('2710.00');
    // Exentas y exoneradas SEPARADAS (Reglamento arts. 70–78); exportación aparte.
    expect(lv.resumen.baseExenta).toBe('1000.00');
    expect(lv.resumen.baseExonerada).toBe('500.00');
    expect(lv.resumen.baseExportacion).toBe('2000.00');
    expect(lv.resumen.totalConIva).toBe('23210.00');
    // La NC aparece como renglón con factor −1.
    expect(lv.filas.some((f) => f.tipoDocumento === 'NOTA_CREDITO' && f.factor === -1)).toBe(true);
    // Columna tipo de operación: la factura de exportación se marca EXPORTACION (derivada).
    expect(lv.filas.some((f) => f.tipoOperacion === 'EXPORTACION')).toBe(true);
    expect(lv.filas.every((f) => f.tipoOperacion !== 'IMPORTACION')).toBe(true); // no hay importación en ventas
  });

  it('TRIPLE IGUALDAD: Libro de Ventas ≡ documentos persistidos ≡ planilla de IVA', async () => {
    const lv = await como(tenantA, () => libros.libroVentas(companyA, 2026, 6));
    const planilla = await como(tenantA, () => declaraciones.planillaIva(companyA, 2026, 6));

    // (1) Documentos persistidos: suma firmada del IVA de document_taxes del período.
    const [doc] = await tdb.ownerSql<{ iva: string }[]>`
      select coalesce(sum(case when d.type = 'NOTA_CREDITO' then -dt.monto_ves else dt.monto_ves end), 0) as iva
      from document_taxes dt join documents d on d.id = dt.document_id
      where d.company_id = ${companyA} and d.type in ('FACTURA','NOTA_CREDITO','NOTA_DEBITO')
        and d.status in ('ISSUED','APPLIED')
        and d.issue_fecha_fiscal >= '2026-06-01' and d.issue_fecha_fiscal < '2026-07-01'`;

    expect(new Decimal(doc!.iva).toFixed(2)).toBe('2710.00'); // documentos
    expect(lv.resumen.ivaTotal).toBe('2710.00'); // libro
    expect(planilla.planilla.debitoFiscal).toBe('2710.00'); // planilla
    // Y los tres coinciden entre sí (cuadre del módulo de impuestos).
    expect(planilla.planilla.debitoFiscal).toBe(lv.resumen.ivaTotal);
    expect(planilla.cuadre.debitoCuadra).toBe(true);
    expect(planilla.cuadre.creditoCuadra).toBe(true);
  });

  it('planilla IVA: crédito = Libro de Compras (interna + importación) y retenciones soportadas', async () => {
    const lc = await como(tenantA, () => libros.libroCompras(companyA, 2026, 6));
    const planilla = await como(tenantA, () => declaraciones.planillaIva(companyA, 2026, 6));
    expect(lc.resumen.ivaTotal).toBe('1760.00'); // C1 1.280 + C2 importación 480
    expect(planilla.planilla.creditoFiscalDelPeriodo).toBe('1760.00');
    expect(planilla.retencionesSoportadas).toBe('300.00');
    expect(planilla.planilla.retencionesDelPeriodo).toBe('300.00');
    // Columna tipo de operación: la compra de importación se marca IMPORTACION.
    expect(lc.filas.some((f) => f.tipoOperacion === 'IMPORTACION')).toBe(true);
    // Columna Nº de comprobante de retención: las compras con retención propia la exponen.
    expect(lc.filas.some((f) => f.numeroComprobanteRetencion !== null && /^\d{14}$/.test(f.numeroComprobanteRetencion))).toBe(true);
  });

  it('export del Libro de Ventas (Excel/PDF) reconcilia con el resumen — cero diferencias', async () => {
    const lv = await como(tenantA, () => libros.libroVentas(companyA, 2026, 6));
    const excel = generarLibroExcel(lv);
    const xml = excel.buffer.toString('utf8');
    // La fila de TOTALES del Excel lleva el total con IVA y el IVA por alícuota del resumen,
    // con las columnas exactas (exonerada y exportación separadas).
    expect(xml).toContain('>23210.00<'); // totalConIva
    expect(xml).toContain('>310.00<'); // IVA ADICIONAL
    expect(xml).toContain('>2240.00<'); // IVA GENERAL
    expect(xml).toContain('>500.00<'); // base exonerada (columna separada)
    expect(xml).toContain('>2000.00<'); // base exportación
    expect(xml).toContain('Tipo operación');
    expect(xml).toContain('Nº comprob. retención');
    expect(excel.filename).toBe('libro-ventas-2026-06.xls');

    const pdf = await generarLibroPdf(lv);
    expect(pdf.buffer.length).toBeGreaterThan(1000); // PDF legal imprimible renderizado
    expect(pdf.filename).toBe('libro-ventas-2026-06.pdf');
  });

  it('declaración de IGTF (julio) cuadra con los cobros del período', async () => {
    const dec = await como(tenantA, () => declaraciones.declaracionIgtf(companyA, 2026, 7));
    const [c] = await tdb.ownerSql<{ igtf: string }[]>`
      select coalesce(sum(igtf_total_ves), 0) as igtf from cobros
      where company_id = ${companyA} and status = 'POSTED'
        and fecha_fiscal >= '2026-07-01' and fecha_fiscal < '2026-08-01'`;
    expect(new Decimal(dec.declaracion.igtfTotalVes).gt(0)).toBe(true);
    expect(dec.declaracion.igtfTotalVes).toBe(new Decimal(c!.igtf).toFixed(2));
  });

  it('presentar la declaración congela un snapshot inmutable (Providencia 121)', async () => {
    const presentada = await como(tenantA, () =>
      declaraciones.presentar({ companyId: companyA, tipo: 'IVA', anio: 2026, mes: 6, numeroDeclaracion: 'DEC-001' }),
    );
    expect(presentada.status).toBe('PRESENTADA');
    expect(presentada.hashIntegridad).toMatch(/^[0-9a-f]{64}$/);
    const snap = presentada.snapshot as { planilla: { debitoFiscal: string } };
    expect(snap.planilla.debitoFiscal).toBe('2710.00');

    // Inmutabilidad: ni la app ni un UPDATE directo pueden modificar lo presentado.
    await expect(
      withTenant(tdb.appDb, (tx) => tx.update(taxReturns).set({ numeroDeclaracion: 'editado' }).where(sql`${taxReturns.id} = ${presentada.id}`), tenantA),
    ).rejects.toThrow(/inmutable/i);

    // Y no se puede presentar dos veces el mismo período (idempotencia dura).
    await expect(
      como(tenantA, () => declaraciones.presentar({ companyId: companyA, tipo: 'IVA', anio: 2026, mes: 6, numeroDeclaracion: 'DEC-002' })),
    ).rejects.toThrow(/sustitutiva|existe/i);
  });

  it('aislamiento RLS: el tenant B no ve las declaraciones del tenant A', async () => {
    const declB = await withTenant(tdb.appDb, (tx) => tx.select().from(taxReturns), tenantB);
    expect(declB).toHaveLength(0);
  });
});
