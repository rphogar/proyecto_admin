import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { postingTemplateLines } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { RevaluacionService } from '../tesoreria/revaluacion.service';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { AsientosManualesService } from './asientos-manuales.service';
import { CierreMensualService } from './cierre-mensual.service';
import { PeriodosService } from './periodos.service';
import { PlantillasService } from './plantillas.service';
import { ReportesService } from './reportes.service';

/**
 * Integración de Contabilidad y cierre (P13) contra Postgres real (testcontainers): asientos
 * manuales con cuadre triple base, plantillas versionadas (v1 HISTORICA inmutable), balance de
 * comprobación y estados financieros en doble base con drill-down, wizard de cierre con diferencial
 * NO realizado idempotente (caso 11), asiento en período cerrado (caso 42), reapertura owner+contador
 * con motivo (caso 43) y aislamiento RLS. Requiere Docker → CI.
 */
describe('Contabilidad y cierre — integración DB (P13)', () => {
  let tdb: TestDatabase;
  let periodos: PeriodosService;
  let asientos: AsientosManualesService;
  let plantillas: PlantillasService;
  let reportes: ReportesService;
  let cierre: CierreMensualService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID(); // períodos + asientos manuales
  const companyR = randomUUID(); // reportes
  const companyC = randomUUID(); // cierre + casos 11/42/43
  const companyB = randomUUID(); // tenant B (RLS)
  const userOwner = randomUUID();
  const userCajero = randomUUID();

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string, userId?: string): TenantContext {
    return { tenantId, userId, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>, userId?: string): Promise<T> {
    return runWithTenantContext(ctx(tenantId, userId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    periodos = new PeriodosService(database, audit);
    asientos = new AsientosManualesService(database, audit);
    plantillas = new PlantillasService(database, audit);
    reportes = new ReportesService(database);
    cierre = new CierreMensualService(database, audit, new RevaluacionService(database, audit));

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values
      (${userOwner}, 'owner@a.com', 'Owner'), (${userCajero}, 'cajero@a.com', 'Cajero')`;
    await tdb.ownerSql`insert into memberships (id, tenant_id, user_id, role) values
      (${randomUUID()}, ${tenantA}, ${userOwner}, 'owner'),
      (${randomUUID()}, ${tenantA}, ${userCajero}, 'cajero')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Conta A C.A.', 'Av. 1, Caracas'),
      (${companyR}, ${tenantA}, ${rif('J', '00000002')}, 'Conta R C.A.', 'Av. 2, Caracas'),
      (${companyC}, ${tenantA}, ${rif('J', '00000003')}, 'Conta C C.A.', 'Av. 3, Caracas'),
      (${companyB}, ${tenantB}, ${rif('J', '00000009')}, 'Conta B C.A.', 'Av. 9, Maracay')`;

    // Períodos
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyR}, 2025, 5, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyC}, 2025, 3, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyC}, 2025, 4, 'OPEN')`;

    // Tasas BCV de marzo 2025 (globales, tenant NULL) para el paso "tasas" del cierre.
    await tdb.ownerSql`insert into exchange_rates (id, currency, rate, rate_date, source)
      select gen_random_uuid(), 'USD', 36, d::date, 'BCV'
      from generate_series('2025-03-01'::date, '2025-03-31'::date, '1 day') as d`;

    for (const c of [companyA, companyR, companyC]) {
      await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: c }), tenantA);
    }
  }, 180_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  // ── Períodos ───────────────────────────────────────────────────────────────
  it('crea períodos de forma idempotente (mismo company/anio/mes no duplica)', async () => {
    const p1 = await como(tenantA, () => periodos.crear({ companyId: companyA, anio: 2025, mes: 9 }), userOwner);
    const p2 = await como(tenantA, () => periodos.crear({ companyId: companyA, anio: 2025, mes: 9 }), userOwner);
    expect(p1.id).toBe(p2.id);
    expect(p1.estado).toBe('OPEN');
  });

  // ── Asientos manuales ────────────────────────────────────────────────────────
  it('valida el cuadre en vivo y rechaza un asiento desbalanceado', async () => {
    const ok = await como(tenantA, () =>
      asientos.validar({
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '2.78' },
          { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '2.78' },
        ],
      }),
    );
    expect(ok.balanceado).toBe(true);

    const malo = await como(tenantA, () =>
      asientos.validar({
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '2.78' },
          { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '90', montoVes: '90', montoUsdMgmt: '2.50' },
        ],
      }),
    );
    expect(malo.balanceado).toBe(false);
  });

  it('postea un asiento manual balanceado (sourceType MANUAL) en período abierto', async () => {
    await como(tenantA, () => periodos.crear({ companyId: companyA, anio: 2025, mes: 5 }), userOwner);
    const r = await como(
      tenantA,
      () =>
        asientos.crear({
          companyId: companyA,
          fecha: '2025-05-10T14:00:00.000Z',
          descripcion: 'Ajuste manual',
          lineas: [
            { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '500', montoVes: '500', montoUsdMgmt: '13.89' },
            { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '500', montoVes: '500', montoUsdMgmt: '13.89' },
          ],
        }),
      userOwner,
    );
    expect(r.entry.estado).toBe('POSTED');
    expect(r.entry.sourceType).toBe('MANUAL');
    expect(r.redirigidoAPeriodoAbierto).toBe(false);
  });

  // ── Plantillas versionadas ───────────────────────────────────────────────────
  it('versiona una plantilla: editar crea v2 y archiva v1 (HISTORICA inmutable)', async () => {
    await como(tenantA, () =>
      plantillas.crear({
        companyId: companyC,
        codigo: 'COMPRA',
        nombre: 'Compra simple',
        operacionTipo: 'COMPRA',
        descripcionAsiento: 'Compra de mercancía',
        lineas: [
          { cuentaCodigo: '5.2', dc: 'D', magnitud: 'BASE' },
          { cuentaCodigo: '2.1', dc: 'C', magnitud: 'BASE' },
        ],
      }),
    );
    const v2 = await como(tenantA, () =>
      plantillas.editar({
        companyId: companyC,
        codigo: 'COMPRA',
        descripcionAsiento: 'Compra de mercancía (v2)',
        lineas: [
          { cuentaCodigo: '5.2', dc: 'D', magnitud: 'NETO' },
          { cuentaCodigo: '1.3.01', dc: 'D', magnitud: 'IVA' },
          { cuentaCodigo: '2.1', dc: 'C', magnitud: 'TOTAL' },
        ],
      }),
    );
    expect(v2.version).toBe(2);
    expect(v2.estado).toBe('VIGENTE');

    // La versión 1 sigue resolviéndose con sus líneas originales.
    const resueltaV1 = await como(tenantA, () => plantillas.obtener(companyC, 'COMPRA', 1));
    expect(resueltaV1.lineas).toHaveLength(2);
    const resueltaVigente = await como(tenantA, () => plantillas.obtener(companyC, 'COMPRA'));
    expect(resueltaVigente.lineas).toHaveLength(3);

    // Inmutabilidad: tocar una línea de la v1 (HISTORICA) es rechazado por el trigger (0042).
    await expect(
      como(tenantA, () =>
        withTenant(tdb.appDb, async (tx) => {
          const v1 = await como(tenantA, () => plantillas.obtener(companyC, 'COMPRA', 1));
          void v1;
          // Forzamos un UPDATE sobre cualquier línea de una versión HISTORICA.
          await tx
            .update(postingTemplateLines)
            .set({ magnitud: 'HACK' })
            .where(eq(postingTemplateLines.magnitud, 'BASE'));
        }),
      ),
    ).rejects.toThrow();
  });

  // ── Balance de comprobación y estados financieros ─────────────────────────────
  it('balance de comprobación y estados en doble base con drill-down (companyR)', async () => {
    const post = (descripcion: string, lineas: unknown[]): Promise<unknown> =>
      como(tenantA, () => asientos.crear({ companyId: companyR, fecha: '2025-05-12T14:00:00.000Z', descripcion, lineas }), userOwner);

    await post('Aporte capital', [
      { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '5000', montoVes: '5000', montoUsdMgmt: '172.41' },
      { cuenta: '3.1', dc: 'C', moneda: 'VES', montoOrigen: '5000', montoVes: '5000', montoUsdMgmt: '172.41' },
    ]);
    await post('Venta gravada', [
      { cuenta: '1.2.01', dc: 'D', moneda: 'VES', montoOrigen: '1160', montoVes: '1160', montoUsdMgmt: '40' },
      { cuenta: '4.1', dc: 'C', moneda: 'VES', montoOrigen: '1000', montoVes: '1000', montoUsdMgmt: '34.48' },
      { cuenta: '2.3.01', dc: 'C', moneda: 'VES', montoOrigen: '160', montoVes: '160', montoUsdMgmt: '5.52' },
    ]);
    await post('Gasto de servicios', [
      { cuenta: '6.2', dc: 'D', moneda: 'VES', montoOrigen: '300', montoVes: '300', montoUsdMgmt: '10.34' },
      { cuenta: '1.1.01', dc: 'C', moneda: 'VES', montoOrigen: '300', montoVes: '300', montoUsdMgmt: '10.34' },
    ]);

    const bc = await como(tenantA, () => reportes.balanceComprobacion({ companyId: companyR, hastaAnio: 2025, hastaMes: 5 }));
    expect(bc.cuadraVes).toBe(true);
    expect(bc.cuadraUsd).toBe(true);
    expect(bc.totalDebeVes).toBe('6460');
    expect(bc.totalDebeVes).toBe(bc.totalHaberVes);

    const er = await como(tenantA, () => reportes.estadoResultados({ companyId: companyR, hastaAnio: 2025, hastaMes: 5 }));
    expect(er.utilidadVes).toBe('700');

    const es = await como(tenantA, () => reportes.estadoSituacion({ companyId: companyR, hastaAnio: 2025, hastaMes: 5 }));
    expect(es.totalActivoVes).toBe('5860');
    expect(es.cuadraVes).toBe(true);
    expect(es.cuadraUsd).toBe(true);

    const drill = await como(tenantA, () => reportes.drillDown({ companyId: companyR, cuenta: '1.1.01', hastaAnio: 2025, hastaMes: 5 }));
    expect(drill).toHaveLength(2); // aporte (D 5000) y gasto (C 300)
  });

  // ── Cierre mensual + diferencial NO realizado idempotente (caso 11) ────────────
  it('cierra el período generando el diferencial NO realizado y es idempotente (caso 11)', async () => {
    // Saldo en divisas que el cierre revalúa: caja USD contra capital, ambos en USD.
    await como(
      tenantA,
      () =>
        asientos.crear({
          companyId: companyC,
          fecha: '2025-03-05T14:00:00.000Z',
          descripcion: 'Aporte en USD',
          lineas: [
            { cuenta: '1.1.02', dc: 'D', moneda: 'USD', montoOrigen: '100', montoVes: '3600', montoUsdMgmt: '100' },
            { cuenta: '3.1', dc: 'C', moneda: 'USD', montoOrigen: '100', montoVes: '3600', montoUsdMgmt: '100' },
          ],
        }),
      userOwner,
    );

    const r1 = await como(tenantA, () => cierre.cerrar({ companyId: companyC, anio: 2025, mes: 3, rateCierre: '40' }), userOwner);
    expect(r1.cierre.estado).toBe('CERRADO');
    expect(r1.period.estado).toBe('CLOSED');

    const revs1 = await tdb.ownerSql`select journal_entry_id, reverso_entry_id from revaluaciones where company_id = ${companyC} and anio = 2025 and mes = 3`;
    expect(revs1).toHaveLength(1);
    expect(revs1[0]!.journal_entry_id).not.toBeNull();
    expect(revs1[0]!.reverso_entry_id).not.toBeNull();

    // Caso 11: re-cerrar es no-op (no duplica la revaluación ni los asientos).
    const r2 = await como(tenantA, () => cierre.cerrar({ companyId: companyC, anio: 2025, mes: 3, rateCierre: '40' }), userOwner);
    expect(r2.cierre.id).toBe(r1.cierre.id);
    const revs2 = await tdb.ownerSql`select count(*)::int as n from revaluaciones where company_id = ${companyC} and anio = 2025 and mes = 3`;
    expect(revs2[0]!.n).toBe(1);
  });

  // ── Caso 42: asiento con fecha en período cerrado ─────────────────────────────
  it('rechaza un asiento con fecha en período cerrado y permite imputarlo al abierto (caso 42)', async () => {
    await expect(
      como(tenantA, () =>
        asientos.crear({
          companyId: companyC,
          fecha: '2025-03-20T14:00:00.000Z',
          descripcion: 'Ajuste tardío',
          lineas: [
            { cuenta: '6.6', dc: 'D', moneda: 'VES', montoOrigen: '50', montoVes: '50', montoUsdMgmt: '1.25' },
            { cuenta: '1.1.01', dc: 'C', moneda: 'VES', montoOrigen: '50', montoVes: '50', montoUsdMgmt: '1.25' },
          ],
        }),
      ),
    ).rejects.toThrow(/cerrado/i);

    const r = await como(
      tenantA,
      () =>
        asientos.crear({
          companyId: companyC,
          fecha: '2025-03-20T14:00:00.000Z',
          descripcion: 'Ajuste tardío',
          registrarEnPeriodoAbierto: { anio: 2025, mes: 4 },
          lineas: [
            { cuenta: '6.6', dc: 'D', moneda: 'VES', montoOrigen: '50', montoVes: '50', montoUsdMgmt: '1.25' },
            { cuenta: '1.1.01', dc: 'C', moneda: 'VES', montoOrigen: '50', montoVes: '50', montoUsdMgmt: '1.25' },
          ],
        }),
      userOwner,
    );
    expect(r.redirigidoAPeriodoAbierto).toBe(true);
    expect(r.entry.descripcion).toMatch(/ref. período cerrado 2025-03/);
  });

  // ── Caso 43: reapertura owner+contador con motivo auditado ─────────────────────
  it('reapertura: cajero prohibido; sin motivo rechazado; owner con motivo reabre y audita (caso 43)', async () => {
    await expect(
      como(tenantA, () => cierre.reabrir({ companyId: companyC, anio: 2025, mes: 3, reason: 'corrección' }), userCajero),
    ).rejects.toThrow(/owner o contador/i);

    await expect(
      como(tenantA, () => cierre.reabrir({ companyId: companyC, anio: 2025, mes: 3 }), userOwner),
    ).rejects.toThrow(/reason/i);

    const r = await como(tenantA, () => cierre.reabrir({ companyId: companyC, anio: 2025, mes: 3, reason: 'reclasificar gasto' }), userOwner);
    expect(r.cierre.estado).toBe('REABIERTO');
    expect(r.cierre.reopenReason).toBe('reclasificar gasto');
    expect(r.period.estado).toBe('OPEN');

    const evt = await tdb.ownerSql`select count(*)::int as n from audit_events where accion = 'contabilidad.reabrir' and tenant_id = ${tenantA}`;
    expect(evt[0]!.n).toBeGreaterThanOrEqual(1);

    // Re-cerrar tras la reapertura vuelve a correr el wizard y bloquea de nuevo.
    const recerrado = await como(tenantA, () => cierre.cerrar({ companyId: companyC, anio: 2025, mes: 3, rateCierre: '40' }), userOwner);
    expect(recerrado.cierre.estado).toBe('CERRADO');
    expect(recerrado.period.estado).toBe('CLOSED');
  });

  // ── Aislamiento RLS entre tenants ─────────────────────────────────────────────
  it('aísla por tenant: el tenant B no ve plantillas ni puede evaluar el cierre del tenant A', async () => {
    await expect(como(tenantB, () => plantillas.listar(companyC))).rejects.toThrow();
    await expect(como(tenantB, () => cierre.evaluar({ companyId: companyC, anio: 2025, mes: 3 }))).rejects.toThrow();
  });
});
