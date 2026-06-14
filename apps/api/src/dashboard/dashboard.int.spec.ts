import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { TasasService } from '../tasas/tasas.service';
import { PosicionService } from '../tesoreria/posicion.service';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { DashboardService } from './dashboard.service';

/**
 * Integración del Dashboard del dueño (P14, docs/06 M0) contra Postgres real (testcontainers). Como
 * la pantalla deriva todo en vivo (regla 8), se siembra el ledger por SQL y se verifican los widgets
 * INDEPENDIENTES de la fecha de corrida (caja, CxC/CxP por saldo de cartera, tasa BCV + variación,
 * estructura del semáforo) más el aislamiento RLS. Los widgets de ventana móvil (ventas/utilidad del
 * mes) dependen del reloj real; aquí se valida su forma, no cifras. Requiere Docker → CI.
 */
describe('Dashboard del dueño — integración DB (P14)', () => {
  let tdb: TestDatabase;
  let dashboard: DashboardService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const cliente = randomUUID();
  const proveedor = randomUUID();
  const periodId = randomUUID();
  const cuentas = new Map<string, string>(); // código → id (companyA)

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  /** Postea un asiento POSTED balanceado (todas las líneas en VES) en el período sembrado. */
  async function postear(descripcion: string, lineas: { codigo: string; dc: 'D' | 'C'; ves: number; usd: number; partyId?: string }[]): Promise<void> {
    const entryId = randomUUID();
    await tdb.ownerSql`insert into journal_entries (id, tenant_id, company_id, fecha, period_id, estado, source_type, descripcion)
      values (${entryId}, ${tenantA}, ${companyA}, '2020-01-15T12:00:00Z', ${periodId}, 'POSTED', 'MANUAL', ${descripcion})`;
    const rows = lineas.map((l, i) => ({
      id: randomUUID(),
      tenant_id: tenantA,
      company_id: companyA,
      entry_id: entryId,
      account_id: cuentas.get(l.codigo)!,
      linea_no: i + 1,
      dc: l.dc,
      moneda: 'VES',
      monto_origen: l.ves.toString(),
      monto_ves: l.ves.toString(),
      monto_usd_mgmt: l.usd.toString(),
      party_id: l.partyId ?? null,
    }));
    await tdb.ownerSql`insert into journal_lines ${tdb.ownerSql(rows)}`;
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    dashboard = new DashboardService(database, new PosicionService(database), new TasasService(database, audit));

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Bodegón A C.A.', 'Av. 1, Caracas'),
      (${companyB}, ${tenantB}, ${rif('J', '00000009')}, 'Bodegón B C.A.', 'Av. 9, Maracay')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado)
      values (${periodId}, ${tenantA}, ${companyA}, 2020, 1, 'OPEN')`;
    await tdb.ownerSql`insert into parties (id, tenant_id, company_id, tipo, rif, razon_social, telefono, dias_credito) values
      (${cliente}, ${tenantA}, ${companyA}, 'cliente', ${rif('V', '10000001')}, 'Cliente Uno', '0414-1112233', 30),
      (${proveedor}, ${tenantA}, ${companyA}, 'proveedor', ${rif('J', '20000002')}, 'Proveedor Dos', '0212-5556677', 15)`;

    // Tasas BCV globales (tenant NULL) con dos fechas distintas y antiguas (siempre ≤ hoy) para la variación.
    await tdb.ownerSql`insert into exchange_rates (id, currency, rate, rate_date, source) values
      (${randomUUID()}, 'USD', 35, '2020-01-01', 'BCV'),
      (${randomUUID()}, 'USD', 36, '2020-01-02', 'BCV')`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
    const filas = await tdb.ownerSql`select codigo, id from accounts where company_id = ${companyA}`;
    for (const f of filas) cuentas.set(f.codigo as string, f.id as string);

    // Caja: D 1.1.01 (Bs) — la posición consolidada la suma (prefijo 1.1.%).
    await postear('Ingreso en caja', [
      { codigo: '1.1.01', dc: 'D', ves: 1000, usd: 25 },
      { codigo: '4.6', dc: 'C', ves: 1000, usd: 25 },
    ]);
    // CxC del cliente: D 1.2.01 5000 Bs / 125 USD.
    await postear('Venta a crédito', [
      { codigo: '1.2.01', dc: 'D', ves: 5000, usd: 125, partyId: cliente },
      { codigo: '4.1', dc: 'C', ves: 5000, usd: 125 },
    ]);
    // CxP al proveedor: C 2.1 3000 Bs / 75 USD.
    await postear('Compra a crédito', [
      { codigo: '5.2', dc: 'D', ves: 3000, usd: 75 },
      { codigo: '2.1', dc: 'C', ves: 3000, usd: 75, partyId: proveedor },
    ]);
  }, 180_000);

  afterAll(async () => {
    await tdb?.stop();
  });

  it('caja consolidada se deriva del ledger (saldo de 1.1.x)', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(d.caja.totalVes).toBe('1000.00');
    expect(d.caja.totalUsd).toBe('25.00');
  });

  it('CxC: saldo de cartera por cliente derivado del ledger (cuenta 1.2.0x)', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(d.cxc.totalPorCobrar).toEqual({ ves: '5000.00', usd: '125.00' });
    expect(d.cxc.topDeudores).toHaveLength(1);
    expect(d.cxc.topDeudores[0]!.nombre).toBe('Cliente Uno');
    expect(d.cxc.topDeudores[0]!.telefono).toBe('0414-1112233');
  });

  it('CxP: saldo a proveedores derivado del ledger (cuenta 2.1)', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(d.cxp.totalPorPagar).toEqual({ ves: '3000.00', usd: '75.00' });
    expect(d.cxp.proximas).toHaveLength(1);
    expect(d.cxp.proximas[0]!.nombre).toBe('Proveedor Dos');
  });

  it('tasa BCV del día con variación contra la publicación anterior', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(d.tasaBcv).not.toBeNull();
    expect(Number(d.tasaBcv!.rate)).toBe(36);
    expect(d.tasaBcv!.variacionPct).toBe('2.9'); // (36 − 35) / 35 ≈ 2.86 %
  });

  it('semáforo fiscal expone las obligaciones de IVA (período en curso y anterior)', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(d.semaforoFiscal.obligaciones).toHaveLength(2);
    expect(d.semaforoFiscal.obligaciones.every((o) => o.tipo === 'IVA')).toBe(true);
    expect(d.semaforoFiscal.obligaciones.every((o) => o.estado === 'PENDIENTE')).toBe(true);
  });

  it('devuelve todos los widgets de la vista (estructura completa)', async () => {
    const d = await como(tenantA, () => dashboard.resumen(companyA));
    expect(Object.keys(d).sort()).toEqual(['alertas', 'caja', 'cxc', 'cxp', 'fecha', 'semaforoFiscal', 'tasaBcv', 'topProductos', 'utilidadMes', 'ventas'].sort());
    expect(d.ventas).toHaveProperty('dia');
    expect(d.ventas).toHaveProperty('semana');
    expect(d.ventas).toHaveProperty('mes');
  });

  it('aísla por tenant: el tenant B no puede leer el dashboard de la empresa A (RLS)', async () => {
    await expect(como(tenantB, () => dashboard.resumen(companyA))).rejects.toThrow();
  });
});
