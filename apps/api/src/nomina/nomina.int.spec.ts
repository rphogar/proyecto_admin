import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif, Decimal } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { SegregacionService } from '../usuarios/segregacion.service';
import type { DatabaseService } from '../db/database.service';
import { journalLines, nominaCorridas, nominaPrestacionesKardex } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ConceptosService } from './conceptos.service';
import { CorridasService } from './corridas.service';
import { PrestacionesService } from './prestaciones.service';
import { TrabajadoresService } from './trabajadores.service';

/**
 * Integración de nómina (P15) contra Postgres real (testcontainers): pre-nómina → aprobación →
 * contabilización con asiento cuadrado en triple base (6.1 contra 2.4.01/2.4.06), inmutabilidad de
 * la corrida CONTABILIZADA y del kardex append-only (regla 4), y aislamiento RLS entre tenants.
 * Requiere Docker → CI.
 */
describe('Nómina — integración DB (P15)', () => {
  let tdb: TestDatabase;
  let trabajadores: TrabajadoresService;
  let conceptos: ConceptosService;
  let corridas: CorridasService;
  let prestaciones: PrestacionesService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const userId = randomUUID();

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    trabajadores = new TrabajadoresService(database, new AuditService());
    conceptos = new ConceptosService(database, new AuditService());
    corridas = new CorridasService(
      database,
      new AuditService(),
      new SegregacionService(database, new AuditService()),
    );
    prestaciones = new PrestacionesService(database, new AuditService());

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userId}, 'rrhh@a.com', 'RRHH')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, dias_utilidades, riesgo_ivss) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Nómina C.A.', 'Av. Principal, Caracas', 30, 'medio')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;

    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('corrida: pre-nómina → aprobación → contabilización con asiento cuadrado', async () => {
    const trabajador = await como(tenantA, () =>
      trabajadores.crear({ companyId: companyA, cedula: 'V-12345678', nombre: 'Juan Pérez', fechaIngreso: '2026-01-01', frecuenciaPago: 'MENSUAL', salarioNormalMensual: '18000' }),
    );
    await como(tenantA, () => conceptos.crear({ companyId: companyA, codigo: 'sueldo', nombre: 'Sueldo', tipo: 'ASIGNACION', salarial: true, formula: 'salario_diario * dias' }));
    await como(tenantA, () => conceptos.crear({ companyId: companyA, codigo: 'sso', nombre: 'S.S.O.', tipo: 'DEDUCCION', formula: 'round(total_devengado_salarial * 0.04, 2)' }));

    const { corrida, recibos } = await como(tenantA, () =>
      corridas.crear({ companyId: companyA, anio: 2026, mes: 6, frecuencia: 'MENSUAL', periodoEtiqueta: '2026-06', fechaInicio: '2026-06-01', fechaFin: '2026-06-30', rateBcv: '40' }),
    );
    expect(recibos).toHaveLength(1);
    expect(recibos[0]?.trabajadorId).toBe(trabajador.id);
    expect(new Decimal(corrida.totalAsignaciones).toFixed(2)).toBe('18000.00');
    expect(new Decimal(corrida.totalNeto).toFixed(2)).toBe('17280.00'); // 18000 − 4% S.S.O.

    await como(tenantA, () => corridas.aprobar({ companyId: companyA, id: corrida.id }));
    const contabilizada = await como(tenantA, () => corridas.contabilizar({ companyId: companyA, id: corrida.id }));
    expect(contabilizada.estado).toBe('CONTABILIZADA');
    expect(contabilizada.journalEntryId).not.toBeNull();

    // Asiento cuadrado en VES: ΣD = ΣC = 18000.
    const lineas = await como(tenantA, () =>
      withTenant(tdb.appDb, (tx) => tx.select().from(journalLines).where(eq(journalLines.entryId, contabilizada.journalEntryId as string)), tenantA),
    );
    const debe = lineas.filter((l) => l.dc === 'D').reduce((a, l) => a.plus(l.montoVes), new Decimal(0));
    const haber = lineas.filter((l) => l.dc === 'C').reduce((a, l) => a.plus(l.montoVes), new Decimal(0));
    expect(debe.toFixed(2)).toBe('18000.00');
    expect(haber.toFixed(2)).toBe('18000.00');
  });

  it('inmutabilidad: la corrida CONTABILIZADA no se puede modificar (trigger)', async () => {
    const [corrida] = await como(tenantA, () => withTenant(tdb.appDb, (tx) => tx.select().from(nominaCorridas).where(eq(nominaCorridas.companyId, companyA)).limit(1), tenantA));
    await expect(
      como(tenantA, () => withTenant(tdb.appDb, (tx) => tx.update(nominaCorridas).set({ estado: 'BORRADOR' }).where(eq(nominaCorridas.id, corrida!.id)), tenantA)),
    ).rejects.toThrow();
  });

  it('kardex de prestaciones append-only: no admite UPDATE (trigger)', async () => {
    const trabajadorId = await primerTrabajador();
    const mov = await como(tenantA, () =>
      prestaciones.registrar({ companyId: companyA, trabajadorId, fecha: '2026-03-31T12:00:00.000Z', tipo: 'DEPOSITO_TRIMESTRAL', montoVes: '10125' }),
    );
    await expect(
      como(tenantA, () => withTenant(tdb.appDb, (tx) => tx.update(nominaPrestacionesKardex).set({ nota: 'editado' }).where(eq(nominaPrestacionesKardex.id, mov.id)), tenantA)),
    ).rejects.toThrow();
  });

  it('aislamiento RLS: el tenant B no ve los trabajadores del tenant A', async () => {
    const desdeB = await como(tenantB, () => trabajadores.listar(companyA).catch(() => []));
    expect(desdeB).toHaveLength(0);
  });

  async function primerTrabajador(): Promise<string> {
    const lista = await como(tenantA, () => trabajadores.listar(companyA));
    return lista[0]!.id;
  }
});
