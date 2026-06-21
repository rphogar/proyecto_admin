import { randomUUID } from 'node:crypto';
import { ImprentaDigitalSimulada } from '@contave/imprenta-digital';
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
import { FacturacionDigitalService } from './facturacion-digital.service';

/**
 * Integración de la factura digital (P24) contra Postgres real (testcontainers). Verifica el ciclo
 * emisión → asignación del número de control digital → entrega electrónica → conservación: la emisión
 * digital SÍ consume el correlativo de la serie (a diferencia de la máquina fiscal), el documento queda
 * ISSUED con el número de control digital, se registran EMISION + ENTREGA + CONSERVACION en la bitácora
 * encadenada, el documento digital lleva su control verificable (identificador/QR), la contingencia del
 * proveedor deja la entrega PENDIENTE con backoff sin afectar la emisión, y la cola está aislada por
 * tenant (RLS). Requiere Docker → CI.
 */
describe('Factura digital — integración DB (P24)', () => {
  let tdb: TestDatabase;
  let database: DatabaseService;
  let facturacion: FacturacionDigitalService;
  let imprenta: ImprentaDigitalSimulada;

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

  async function nuevaSerie(prefijo = 'FD'): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', ${prefijo}, 1)`;
    return id;
  }
  async function nextNumber(serieId: string): Promise<number> {
    const [row] = await tdb.ownerSql`select next_number from series where id = ${serieId}`;
    return Number(row?.next_number);
  }

  /** Cuerpo de una factura digital en VES con destinatario de entrega explícito. */
  function facturaDigitalBody(seriesId: string, extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      companyId: companyA,
      seriesId,
      tipo: 'FACTURA',
      moneda: 'VES',
      rateUsdMgmt: '40',
      paymentCondition: 'CONTADO',
      issueDate: ISSUE,
      partyId: clienteA,
      entrega: { canal: 'EMAIL', direccion: 'cliente@correo.com' },
      lineas: [
        { descripcion: 'Producto gravado', cantidad: '2', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
      ...extra,
    };
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    const fiscalEventLog = new FiscalEventLogService(database);
    const emision = new EmisionService(database, audit, fiscalEventLog, new RemisionService(database, new StubRemisionAdapter()));
    const documentos = new DocumentosService(database, emision, audit);
    imprenta = new ImprentaDigitalSimulada({ prefijo: 'DIG' });
    facturacion = new FacturacionDigitalService(database, emision, documentos, fiscalEventLog, imprenta);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa A C.A.', 'Av. Principal, Caracas'),
      (${companyB}, ${tenantB}, ${rif('00000002')}, 'Empresa B C.A.', 'Av. Secundaria, Valencia')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, email)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario', 'maestro@correo.com')`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('emisión digital (ciclo emisión → control → entrega)', () => {
    it('emite ISSUED con número de control digital, consume la serie y entrega + conserva', async () => {
      imprenta.reparar();
      const serie = await nuevaSerie();
      const res = await como(tenantA, () => facturacion.emitirDigital(facturaDigitalBody(serie)));

      // Documento emitido inmutable con el número de control digital de la imprenta.
      expect(res.documento.documento.status).toBe('ISSUED');
      expect(res.documento.documento.medioEmision).toBe('IMPRENTA_DIGITAL');
      expect(res.documento.documento.number).toBe(1);
      expect(res.documento.documento.controlNumber).toMatch(/^DIG-\d{8}$/);
      expect(res.documento.documento.totalVes).toBe('2320.00000000');

      // La emisión digital SÍ consume el correlativo (numeración por software, consecutiva).
      expect(await nextNumber(serie)).toBe(2);

      // El documento digital lleva su control verificable (identificador + QR + URL).
      expect(res.documentoDigital.control.identificador).toMatch(/^[0-9a-f]{64}$/);
      expect(res.documentoDigital.control.qr).toContain(res.documentoDigital.control.identificador);
      expect(res.documentoDigital.numeroControl).toBe(res.documento.documento.controlNumber);

      // Entrega y conservación completadas.
      expect(res.entrega.estado).toBe('ENTREGADO');
      expect(res.entrega.conservacionEstado).toBe('CONSERVADO');
      expect(res.entrega.destino).toBe('cliente@correo.com');
      expect(res.entrega.conservacionRef).toMatch(/^CONS-DIG-\d{8}$/);
      expect(imprenta.entregas).toHaveLength(1);
      expect(imprenta.conservaciones).toHaveLength(1);

      // Bitácora: EMISION + ENTREGA + CONSERVACION, cadena verificable.
      const eventos = await tdb.ownerSql`select event_type from fiscal_event_log
        where document_id = ${res.documento.documento.id} order by seq`;
      expect(eventos.map((e) => e.event_type)).toEqual(['EMISION', 'ENTREGA', 'CONSERVACION']);
      const verif = await como(tenantA, () => new FiscalEventLogService(database).verificarCadena());
      expect(verif.ok).toBe(true);
    });

    it('usa el email del tercero si no se indica dirección de entrega', async () => {
      imprenta.reparar();
      const serie = await nuevaSerie();
      const body = facturaDigitalBody(serie);
      delete body.entrega;
      const res = await como(tenantA, () => facturacion.emitirDigital(body));
      expect(res.entrega.destino).toBe('maestro@correo.com');
      expect(res.entrega.estado).toBe('ENTREGADO');
    });

    it('rechaza un documento inválido ANTES de pedir el control digital (no malgasta numeración)', async () => {
      imprenta.reparar();
      const antes = imprenta.controlesAsignados.length;
      const serie = await nuevaSerie();
      // Consumidor final sin umbral configurado ⇒ incumplimiento (no es SIN_NUMERO_CONTROL).
      const body = facturaDigitalBody(serie, { partyId: null });
      await expect(como(tenantA, () => facturacion.emitirDigital(body))).rejects.toThrow(/requisitos de emisión/i);
      expect(imprenta.controlesAsignados.length).toBe(antes);
      expect(await nextNumber(serie)).toBe(1);
    });
  });

  describe('contingencia del proveedor', () => {
    it('imprenta caída al asignar el control ⇒ no emite ni consume serie', async () => {
      const serie = await nuevaSerie();
      imprenta.caer();
      await expect(como(tenantA, () => facturacion.emitirDigital(facturaDigitalBody(serie)))).rejects.toThrow(/no disponible/i);
      imprenta.reparar();
      expect(await nextNumber(serie)).toBe(1);
      const docs = await tdb.ownerSql`select id from documents where series_id = ${serie}`;
      expect(docs).toHaveLength(0);
    });

    it('imprenta caída al entregar ⇒ documento emitido, entrega PENDIENTE con backoff; procesar la completa', async () => {
      const serie = await nuevaSerie();
      // Asigna el control con la imprenta sana; luego cae justo antes de entregar/conservar.
      imprenta.reparar();
      const original = imprenta.entregar.bind(imprenta);
      let caidaUsada = false;
      imprenta.entregar = async (s) => {
        if (!caidaUsada) {
          caidaUsada = true;
          return { tipo: 'REINTENTABLE', motivo: 'proveedor de entrega caído' };
        }
        return original(s);
      };

      const res = await como(tenantA, () => facturacion.emitirDigital(facturaDigitalBody(serie)));
      imprenta.entregar = original;

      // El documento se emitió pese a la falla de entrega (la emisión no depende de la entrega).
      expect(res.documento.documento.status).toBe('ISSUED');
      expect(await nextNumber(serie)).toBe(2);
      expect(res.entrega.estado).toBe('PENDIENTE');
      expect(res.entrega.reintentos).toBe(1);
      expect(new Date(res.entrega.proximoIntento).getTime()).toBeGreaterThan(Date.now());

      // El reproceso, con próximo intento vencido, entrega y cierra la cola.
      await tdb.ownerSql`update digital_invoice_deliveries set proximo_intento = now() - interval '1 minute' where id = ${res.entrega.id}`;
      const resumen = await como(tenantA, () => facturacion.procesarPendientes());
      expect(resumen.entregados).toBeGreaterThanOrEqual(1);
      const [fila] = await tdb.ownerSql`select estado, conservacion_estado from digital_invoice_deliveries where id = ${res.entrega.id}`;
      expect(fila?.estado).toBe('ENTREGADO');
      expect(fila?.conservacion_estado).toBe('CONSERVADO');
    });
  });

  describe('aislamiento (RLS)', () => {
    it('la cola está aislada por tenant: B no ve las entregas de A', async () => {
      imprenta.reparar();
      const serie = await nuevaSerie();
      await como(tenantA, () => facturacion.emitirDigital(facturaDigitalBody(serie)));
      const colaA = await como(tenantA, () => facturacion.listar({ companyId: companyA }));
      expect(colaA.length).toBeGreaterThan(0);
      const colaB = await como(tenantB, () => facturacion.listar({}));
      expect(colaB).toHaveLength(0);
    });
  });
});
