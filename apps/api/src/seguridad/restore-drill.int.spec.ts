import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { StubRemisionAdapter } from '../cumplimiento/remision-adapter';
import { RemisionService } from '../cumplimiento/remision.service';
import { EmisionService } from '../documentos/emision.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ejecutarDrill } from './drill-invariantes';
import { verificarNumeracion } from './verificacion-invariantes';

/**
 * Drill de backup/restore (caso 56): un contenedor recién migrado simula la base restaurada en
 * ambiente limpio. Tras poblarla con emisiones reales (asientos balanceados + correlativo), el
 * drill de invariantes (§7) debe pasar al 100%. Requiere Docker → CI.
 */
describe('Drill backup/restore — invariantes del ledger (P18, caso 56)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;

  const tenantA = randomUUID();
  const companyA = randomUUID();
  const clienteA = randomUUID();
  const periodoJunio = randomUUID();
  const ISSUE = '2026-06-12T14:00:00.000Z';

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function como<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenantId: tenantA, userId: undefined, ip: undefined, device: undefined }, fn);
  }
  async function nuevaSerie(prefijo = ''): Promise<string> {
    const id = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${id}, ${tenantA}, ${companyA}, 'FACTURA', ${prefijo}, 1)`;
    return id;
  }
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
        { descripcion: 'Servicio', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
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
      (${periodoJunio}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, condicion_iva)
      values (${clienteA}, ${tenantA}, ${companyA}, 'cliente', ${rif('00000003')}, 'Cliente A C.A.', 'ordinario')`;
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    // Poblar la "base restaurada" con varias emisiones reales en dos series.
    const s1 = await nuevaSerie('A');
    const s2 = await nuevaSerie('B');
    for (let i = 0; i < 3; i += 1) {
      await como(() => emision.emitir(facturaBody(s1)));
    }
    await como(() => emision.emitir(facturaBody(s2)));
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('los invariantes del ledger se cumplen al 100% tras el restore', async () => {
    const reporte = await ejecutarDrill(tdb.ownerSql);
    expect(reporte.violaciones).toEqual([]);
    expect(reporte.ok).toBe(true);
    // 4 documentos → 4 asientos POSTED; 2 series verificadas.
    expect(reporte.asientosVerificados).toBe(4);
    expect(reporte.seriesVerificadas).toBe(2);
  });

  it('el correlativo extraído de la base no tiene huecos ni duplicados', async () => {
    const docs = await tdb.ownerSql<{ series_id: string; number: number }[]>`
      SELECT series_id, number FROM documents WHERE number IS NOT NULL`;
    const { violaciones } = verificarNumeracion(
      docs.map((d) => ({ seriesId: d.series_id, number: Number(d.number) })),
    );
    expect(violaciones).toEqual([]);
  });
});
