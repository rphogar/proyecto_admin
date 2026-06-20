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
import { verificarNumeracion } from './verificacion-invariantes';

/**
 * Prueba de carga (P18): 500 emisiones sobre una misma serie deben mantener el correlativo
 * **perfecto** (sin huecos ni duplicados) bajo concurrencia, sosteniendo ≥ 500 documentos/minuto.
 * Lleva los casos 21/53 a escala de objetivo de carga. Requiere Docker → CI.
 *
 * La numeración serializa en la fila de `series` (FOR UPDATE implícito); la concurrencia se acota
 * para no agotar el pool (cada emisión es una transacción con asiento + líneas + eventos).
 */
describe('Carga de emisión — 500 docs/min sin romper numeración (P18)', () => {
  let tdb: TestDatabase;
  let emision: EmisionService;

  const tenantA = randomUUID();
  const companyA = randomUUID();
  const clienteA = randomUUID();
  const periodoJunio = randomUUID();
  const ISSUE = '2026-06-12T14:00:00.000Z';
  const N = 500;
  const CONCURRENCIA = 20;

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function como<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext({ tenantId: tenantA, userId: undefined, ip: undefined, device: undefined }, fn);
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

  /** Ejecuta `tareas` con un tope de `limite` en vuelo a la vez. */
  async function conLimite<T>(tareas: (() => Promise<T>)[], limite: number): Promise<T[]> {
    const resultados: T[] = new Array<T>(tareas.length);
    let siguiente = 0;
    async function worker(): Promise<void> {
      while (siguiente < tareas.length) {
        const i = siguiente;
        siguiente += 1;
        resultados[i] = await tareas[i]!();
      }
    }
    await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, () => worker()));
    return resultados;
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
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it(`emite ${N} documentos con correlativo 1..${N} perfecto y ≥ 500 docs/min`, async () => {
    const serieId = randomUUID();
    await tdb.ownerSql`insert into series (id, tenant_id, company_id, doc_type, prefijo, next_number)
      values (${serieId}, ${tenantA}, ${companyA}, 'FACTURA', 'L', 1)`;

    const tareas = Array.from({ length: N }, () => () => como(() => emision.emitir(facturaBody(serieId))));
    const inicio = Date.now();
    const resultados = await conLimite(tareas, CONCURRENCIA);
    const elapsedMs = Date.now() - inicio;

    // Correlativo perfecto: 1..N sin huecos ni duplicados.
    const numeros = resultados.map((r) => r.documento.number ?? -1).sort((a, b) => a - b);
    expect(numeros).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // Verificación independiente desde la base (no solo desde los resultados en memoria).
    const docs = await tdb.ownerSql<{ series_id: string; number: number }[]>`
      SELECT series_id, number FROM documents WHERE series_id = ${serieId} AND number IS NOT NULL`;
    expect(docs).toHaveLength(N);
    expect(verificarNumeracion(docs.map((d) => ({ seriesId: d.series_id, number: Number(d.number) }))).violaciones).toEqual([]);

    // El próximo número quedó en N+1 (contador transaccional, sin saltos).
    const [serie] = await tdb.ownerSql`select next_number from series where id = ${serieId}`;
    expect(Number(serie?.next_number)).toBe(N + 1);

    // Throughput objetivo: ≥ 500 documentos/minuto.
    const docsPorMinuto = (N / elapsedMs) * 60_000;
    console.log(`Carga: ${N} docs en ${elapsedMs} ms → ${Math.round(docsPorMinuto)} docs/min`);
    expect(docsPorMinuto).toBeGreaterThanOrEqual(500);
  }, 120_000);
});
