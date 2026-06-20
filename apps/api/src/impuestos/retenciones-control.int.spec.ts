import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif, fechaFiscal } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { ComprasService } from '../compras/compras.service';
import type { DatabaseService } from '../db/database.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { RetencionesControlService } from './retenciones-control.service';

/**
 * Integración del control de retenciones (P22) contra Postgres real (testcontainers):
 *  - **Caso 28**: facturas a clientes agentes (SPE) sin comprobante de retención recibido; las > 30
 *    días se reportan como vencidas; las que sí tienen comprobante se excluyen; las de clientes no
 *    agentes no entran.
 *  - **ARC anual de ISLR** por proveedor: consolida las retenciones de ISLR emitidas en el ejercicio.
 * Requiere Docker → CI.
 */
describe('Control de retenciones y ARC ISLR — integración DB (P22)', () => {
  let tdb: TestDatabase;
  let control: RetencionesControlService;
  let compras: ComprasService;

  const tenantA = randomUUID();
  const companyA = randomUUID(); // SPE
  const clienteAgente = randomUUID();
  const clienteNormal = randomUUID();
  const provPN = randomUUID();
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

  async function serieFactura(): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', '', 1)`;
    return id;
  }

  /** Inserta una factura de venta emitida (raw, para fijar fechas históricas deterministas). */
  async function factura(opts: { seriesId: string; numero: number; partyId: string; rifCliente: string; fechaFis: string; conComprobante?: boolean }): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into documents
      (id, tenant_id, company_id, type, series_id, number, status, medio_emision, party_id, party_rif, party_nombre, issue_date, issue_fecha_fiscal, currency, total_ves)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', ${opts.seriesId}, ${opts.numero}, 'ISSUED', 'FORMA_LIBRE', ${opts.partyId}, ${opts.rifCliente}, 'Cliente', ${`${opts.fechaFis}T12:00:00Z`}, ${opts.fechaFis}, 'VES', '1160.00')`;
    if (opts.conComprobante === true) {
      await tdb.ownerSql`insert into retentions_received
        (id, tenant_id, company_id, document_id, party_id, agente_rif, agente_nombre, tipo, numero_comprobante, periodo_anio, periodo_mes, currency, base_origen, base_ves, porcentaje, monto_origen, monto_ves, monto_usd_mgmt, fecha_comprobante, fecha_recepcion)
        values (${randomUUID()}, ${tenantA}, ${companyA}, ${id}, ${opts.partyId}, ${rif('G', '20000001')}, 'Cliente Agente', 'IVA', '20200200000001', 2020, 2, 'VES', '1000', '1000', 75, '120', '120', '3', ${opts.fechaFis}, ${opts.fechaFis})`;
    }
    return id;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    control = new RetencionesControlService(database);
    compras = new ComprasService(database, new AuditService());

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Tenant A', 'tenant-a')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Agente SPE C.A.', 'Av. Principal, Caracas', true)`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, es_agente_retencion_iva, pct_retencion_iva) values
      (${clienteAgente}, ${tenantA}, ${companyA}, 'cliente', ${rif('G', '20000001')}, 'Cliente Agente', 'especial', true, 75),
      (${clienteNormal}, ${tenantA}, ${companyA}, 'cliente', ${rif('J', '00000009')}, 'Cliente Normal', 'ordinario', false, null)`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva, pct_retencion_iva) values
      (${provPN}, ${tenantA}, ${companyA}, 'proveedor', ${rif('V', '00000005')}, 'Juan Perito', 'ordinario', 75)`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    const s = await serieFactura();
    const hoy = fechaFiscal(new Date());
    await factura({ seriesId: s, numero: 1, partyId: clienteAgente, rifCliente: rif('G', '20000001'), fechaFis: '2020-01-15' }); // vieja, sin comprobante → vencida
    await factura({ seriesId: s, numero: 2, partyId: clienteAgente, rifCliente: rif('G', '20000001'), fechaFis: hoy }); // reciente, sin comprobante → no vencida
    await factura({ seriesId: s, numero: 3, partyId: clienteAgente, rifCliente: rif('G', '20000001'), fechaFis: '2020-02-15', conComprobante: true }); // con comprobante → excluida
    await factura({ seriesId: s, numero: 4, partyId: clienteNormal, rifCliente: rif('J', '00000009'), fechaFis: '2020-01-20' }); // cliente no agente → excluida

    // ISLR emitidas (vía ComprasService) para el ARC del ejercicio 2026.
    for (const [n, base] of [['ARC-1', '10000'], ['ARC-2', '20000']] as const) {
      await como(tenantA, () =>
        compras.registrar({
          companyId: companyA,
          partyId: provPN,
          numeroDocumento: n,
          numeroControl: `00-${n}`,
          moneda: 'VES',
          rateUsdMgmt: '40',
          fechaDocumento: FECHA,
          cuentaDestino: '6.2',
          conceptoIslr: '001',
          tarifaIslr: '3',
          lineas: [{ descripcion: 'Honorarios', cantidad: '1', precioUnitarioOrigen: base, alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
        }),
      );
    }
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('caso 28 — lista facturas a SPE vencidas (>30 días) y excluye con comprobante / no agente', async () => {
    const r = await como(tenantA, () => control.facturasAspeSinComprobante(companyA));
    expect(r.umbralDias).toBe(30);
    // Sin comprobante: la vieja + la reciente (2); la #3 tiene comprobante, la #4 no es agente.
    expect(r.totalSinComprobante).toBe(2);
    // Vencidas: solo la vieja (2020).
    expect(r.facturas).toHaveLength(1);
    expect(r.facturas[0]!.fechaFiscal).toBe('2020-01-15');
    expect(r.facturas[0]!.diasTranscurridos).toBeGreaterThan(30);
    expect(r.facturas[0]!.vencida).toBe(true);
  });

  it('caso 28 — umbral configurable: con dias=0 todas las pendientes salen como vencidas', async () => {
    const r = await como(tenantA, () => control.facturasAspeSinComprobante(companyA, 0));
    expect(r.facturas).toHaveLength(2);
  });

  it('ARC ISLR — consolida las retenciones emitidas al proveedor en el ejercicio', async () => {
    const arc = await como(tenantA, () => control.arcIslrProveedores(companyA, 2026));
    expect(arc).toHaveLength(1);
    const p = arc[0]!;
    expect(p.partyId).toBe(provPN);
    // 10.000×3%−22,50? Sin sustraendo (no se pasó) → 300 + 600 = 900 retenido; base 30.000.
    expect(p.arc.retenidoTotalVes).toBe('900.00');
    expect(p.arc.baseTotalVes).toBe('30000.00');
    expect(p.arc.porConcepto[0]!.concepto).toBe('001');
    expect(p.arc.comprobantes).toBe(2);
  });
});
