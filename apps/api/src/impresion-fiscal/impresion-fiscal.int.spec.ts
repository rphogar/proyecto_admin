import { randomUUID } from 'node:crypto';
import { ImpresoraFiscalSimulada } from '@contave/impresora-fiscal';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import type { DatabaseService } from '../db/database.service';
import { DocumentosService } from '../documentos/documentos.service';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ImpresionFiscalService } from './impresion-fiscal.service';

/**
 * Integración de la impresora fiscal (P23) contra Postgres real (testcontainers). Verifica que la
 * emisión por máquina fiscal NO consume correlativo de serie (la numeración la asigna el hardware),
 * que el acuse IMPRESO emite el documento (ISSUED) y registra EMISION + IMPRESION en la bitácora, que
 * la contingencia (impresora caída) deja el trabajo PENDIENTE con backoff + evento FALLO sin romper la
 * numeración, el contrato del agente (reclamar/reportar) y el aislamiento RLS de la cola. Requiere
 * Docker → CI.
 */
describe('Impresora fiscal — integración DB (P23)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let impresion: ImpresionFiscalService;
  let simulada: ImpresoraFiscalSimulada;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const clienteA = randomUUID();

  // 2026-06-12 14:00 UTC → 10:00 Caracas → período 2026-06 (OPEN).
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

  async function nuevaSerie(prefijo = 'MF'): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', ${prefijo}, 1)`;
    return id;
  }
  async function nextNumber(serieId: string): Promise<number> {
    const [row] = await tdb.ownerSql`select next_number from series where id = ${serieId}`;
    return Number(row?.next_number);
  }

  /** Cuerpo de una factura de máquina fiscal en VES (sin número de control: lo asigna el hardware). */
  function maquinaFiscalBody(seriesId: string): Record<string, unknown> {
    return {
      companyId: companyA,
      seriesId,
      tipo: 'FACTURA',
      moneda: 'VES',
      rateUsdMgmt: '40',
      medioEmision: 'MAQUINA_FISCAL',
      paymentCondition: 'CONTADO',
      issueDate: ISSUE,
      partyId: clienteA,
      lineas: [
        { descripcion: 'Producto gravado', cantidad: '2', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
      mediosPago: [{ tipo: 'EFECTIVO', monto: '2320.00' }],
    };
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    const fiscalEventLog = new FiscalEventLogService(database);
    const emision = new EmisionService(database, audit, fiscalEventLog, new RemisionService(database, new StubRemisionAdapter()));
    const documentos = new DocumentosService(database, emision, audit);
    simulada = new ImpresoraFiscalSimulada({ serie: 'HKA' });
    impresion = new ImpresionFiscalService(database, emision, documentos, fiscalEventLog, audit, simulada);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa A C.A.', 'Av. Principal, Caracas'),
      (${companyB}, ${tenantB}, ${rif('00000002')}, 'Empresa B C.A.', 'Av. Secundaria, Valencia')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('emisión por máquina fiscal (numeración del hardware)', () => {
    it('imprimirDirecto emite el documento ISSUED con la numeración del hardware y SIN consumir la serie', async () => {
      simulada.reparar();
      const serie = await nuevaSerie();
      const res = await como(tenantA, () => impresion.imprimirDirecto(maquinaFiscalBody(serie)));

      expect(res.job.estado).toBe('IMPRESO');
      expect(res.documento).not.toBeNull();
      expect(res.documento?.documento.status).toBe('ISSUED');
      expect(res.documento?.documento.medioEmision).toBe('MAQUINA_FISCAL');
      // El número del documento = número fiscal del hardware; el control = control fiscal del hardware.
      expect(res.documento?.documento.number).toBe(Number.parseInt(res.job.numeroFiscal!, 10));
      expect(res.documento?.documento.controlNumber).toBe(res.job.controlFiscal);
      expect(res.documento?.documento.totalVes).toBe('2320.00000000');

      // La serie NO se consumió: la autoridad de numeración es la impresora (decisión P23).
      expect(await nextNumber(serie)).toBe(1);

      // Bitácora: EMISION + IMPRESION para el documento, cadena verificable.
      const eventos = await tdb.ownerSql`select event_type from fiscal_event_log
        where document_id = ${res.documento!.documento.id} order by seq`;
      expect(eventos.map((e) => e.event_type)).toEqual(['EMISION', 'IMPRESION']);
      const verif = await como(tenantA, () => new FiscalEventLogService(database).verificarCadena());
      expect(verif.ok).toBe(true);
    });

    it('rechaza divisa y tipos distintos de FACTURA (pendientes en esta iteración)', async () => {
      const serie = await nuevaSerie();
      await expect(como(tenantA, () => impresion.imprimirDirecto({ ...maquinaFiscalBody(serie), moneda: 'USD', rateBcv: '40' }))).rejects.toThrow(
        /bol[ií]vares/i,
      );
      await expect(como(tenantA, () => impresion.imprimirDirecto({ ...maquinaFiscalBody(serie), tipo: 'NOTA_CREDITO' }))).rejects.toThrow(
        /FACTURA/i,
      );
    });
  });

  describe('contingencia (impresora caída)', () => {
    it('deja el trabajo PENDIENTE con backoff y registra FALLO, sin emitir documento ni consumir serie', async () => {
      const serie = await nuevaSerie();
      simulada.caer();
      const res = await como(tenantA, () => impresion.imprimirDirecto(maquinaFiscalBody(serie)));
      simulada.reparar();

      expect(res.documento).toBeNull();
      expect(res.job.estado).toBe('PENDIENTE');
      expect(res.job.reintentos).toBe(1);
      expect(res.job.ultimoError).toMatch(/contingencia|ca[ií]da/i);
      expect(new Date(res.job.proximoIntento).getTime()).toBeGreaterThan(Date.now());
      expect(await nextNumber(serie)).toBe(1);

      // Se registró el evento FALLO en la bitácora (contingencia auditable).
      const [fallo] = await tdb.ownerSql`select event_type, payload from fiscal_event_log
        where company_id = ${companyA} and event_type = 'FALLO' order by seq desc limit 1`;
      expect(fallo?.event_type).toBe('FALLO');

      // Ningún documento se emitió para este trabajo.
      const docs = await tdb.ownerSql`select id from documents where series_id = ${serie}`;
      expect(docs).toHaveLength(0);
    });
  });

  describe('contrato del agente local (reclamar / reportar)', () => {
    it('solicitar encola PENDIENTE; el agente reclama y reporta IMPRESO → documento emitido', async () => {
      const serie = await nuevaSerie();
      const job = await como(tenantA, () => impresion.solicitarImpresion(maquinaFiscalBody(serie)));
      expect(job.estado).toBe('PENDIENTE');

      const reclamados = await como(tenantA, () => impresion.reclamar({ agenteId: 'caja-01', limite: 10 }));
      const mio = reclamados.find((r) => r.id === job.id);
      expect(mio).toBeDefined();
      expect(mio?.comandos.some((c) => c.clase === 'CERRAR_DOC')).toBe(true);

      const reportado = await como(tenantA, () =>
        impresion.reportarResultado({
          jobId: job.id,
          resultado: { tipo: 'IMPRESO', numeroFiscal: '00000123', controlFiscal: 'HKA-00000123', acuse: { ok: true } },
        }),
      );
      expect(reportado.estado).toBe('IMPRESO');
      expect(reportado.documentId).not.toBeNull();

      const [doc] = await tdb.ownerSql`select status, number, control_number, medio_emision from documents where id = ${reportado.documentId!}`;
      expect(doc?.status).toBe('ISSUED');
      expect(Number(doc?.number)).toBe(123);
      expect(doc?.control_number).toBe('HKA-00000123');
      expect(doc?.medio_emision).toBe('MAQUINA_FISCAL');
      expect(await nextNumber(serie)).toBe(1);

      // Reintentar/duplicar el reporte es idempotente (no re-emite).
      await expect(
        como(tenantA, () =>
          impresion.reportarResultado({ jobId: job.id, resultado: { tipo: 'IMPRESO', numeroFiscal: '00000124', controlFiscal: 'HKA-00000124' } }),
        ),
      ).rejects.toThrow(/ya fue impreso/i);
    });
  });

  describe('reportes y aislamiento', () => {
    it('reporteZ pasa por el adapter y devuelve el cierre', async () => {
      simulada.reparar();
      const reporte = (await como(tenantA, () => impresion.reporteZ({ companyId: companyA }))) as { clase: string };
      expect(reporte.clase).toBe('Z');
    });

    it('la cola está aislada por tenant (RLS): B no ve los trabajos de A', async () => {
      const serie = await nuevaSerie();
      await como(tenantA, () => impresion.solicitarImpresion(maquinaFiscalBody(serie)));
      const colaA = await como(tenantA, () => impresion.listar({ companyId: companyA }));
      expect(colaA.length).toBeGreaterThan(0);
      const colaB = await como(tenantB, () => impresion.listar({}));
      expect(colaB).toHaveLength(0);
    });
  });
});
