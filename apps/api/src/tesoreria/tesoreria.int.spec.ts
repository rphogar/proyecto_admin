import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { SegregacionService } from '../usuarios/segregacion.service';
import type { DatabaseService } from '../db/database.service';
import { revaluaciones, statementLines, transferencias } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { BancosService } from './bancos.service';
import { CierresCajaService } from './cierres-caja.service';
import { ConciliacionService } from './conciliacion.service';
import { ImportadoresService } from './importadores.service';
import { PosicionService } from './posicion.service';
import { RevaluacionService } from './revaluacion.service';
import { TransferenciasService } from './transferencias.service';

const BANESCO = readFileSync(resolve(__dirname, 'parsers/__fixtures__/banesco-movimientos.csv'), 'utf8');

/**
 * Integración de Tesorería (P11) contra Postgres real (testcontainers): transferencias con conversión
 * e inmutabilidad (regla 4), cierre de caja con arqueo por método (caso 5), idempotencia del
 * importador y de la revaluación (caso 11), conciliación n:m y aislamiento RLS. Requiere Docker → CI.
 */
describe('Tesorería — integración DB (P11)', () => {
  let tdb: TestDatabase;
  let bancos: BancosService;
  let transfers: TransferenciasService;
  let cierres: CierresCajaService;
  let importadores: ImportadoresService;
  let conciliacion: ConciliacionService;
  let revaluacion: RevaluacionService;
  let posicion: PosicionService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const cuentas = new Map<string, string>(); // código → id

  function rif(ocho: string): string {
    return `J-${ocho}-${calcularDigitoVerificadorRif('J', ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    bancos = new BancosService(database, audit);
    transfers = new TransferenciasService(database, audit);
    cierres = new CierresCajaService(database, audit);
    importadores = new ImportadoresService(database, audit);
    conciliacion = new ConciliacionService(
      database,
      audit,
      new SegregacionService(database, audit),
    );
    revaluacion = new RevaluacionService(database, audit);
    posicion = new PosicionService(database);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal, spe) values
      (${companyA}, ${tenantA}, ${rif('00000001')}, 'Empresa C.A.', 'Av. Principal, Caracas', false)`;
    for (const [anio, mes] of [[2026, 5], [2026, 6], [2026, 7]] as const) {
      await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
        (${randomUUID()}, ${tenantA}, ${companyA}, ${anio}, ${mes}, 'OPEN')`;
    }
    await withTenant(tdb.appDb, (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }), tenantA);

    const filas = await tdb.ownerSql<{ id: string; codigo: string }[]>`select id, codigo from accounts where company_id = ${companyA}`;
    for (const f of filas) cuentas.set(f.codigo, f.id);

    // Métodos de pago para el cierre de caja.
    await tdb.ownerSql`insert into payment_methods (id, tenant_id, company_id, codigo, nombre, moneda, cuenta_id, causa_igtf) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 'PAGO_MOVIL', 'Pago Móvil', 'VES', ${cuentas.get('1.1.03')!}, false)`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('transferencia con conversión Bs→USD: cuadra, marca diferencial y queda POSTED', async () => {
    const fila = await como(tenantA, () =>
      transfers.registrar({
        companyId: companyA,
        fecha: '2026-06-10T14:00:00.000Z',
        descripcion: 'Compra de divisas',
        origen: { cuentaCodigo: '1.1.03', moneda: 'VES', monto: '10200', rateBcv: null },
        destino: { cuentaCodigo: '1.1.02', moneda: 'USD', monto: '40', rateBcv: '250' },
        rateUsdMgmt: '250',
      }),
    );
    expect(fila.status).toBe('POSTED');
    expect(fila.journalEntryId).not.toBeNull();

    const lineas = await tdb.ownerSql<{ codigo: string; dc: string; monto_ves: string }[]>`
      select a.codigo, jl.dc, jl.monto_ves from journal_lines jl
      join accounts a on a.id = jl.account_id where jl.entry_id = ${fila.journalEntryId!}`;
    const debe = lineas.filter((l) => l.dc === 'D').reduce((s, l) => s + Number(l.monto_ves), 0);
    const haber = lineas.filter((l) => l.dc === 'C').reduce((s, l) => s + Number(l.monto_ves), 0);
    expect(debe).toBeCloseTo(haber, 2);
    expect(lineas.some((l) => l.codigo === '6.7')).toBe(true); // pérdida (entregó 10.200 por $40=10.000)
  });

  it('inmutabilidad: una transferencia POSTED no admite UPDATE (regla 4)', async () => {
    const [t] = await como(tenantA, () => transfers.listar(companyA));
    await expect(
      withTenant(tdb.appDb, (tx) => tx.update(transferencias).set({ descripcion: 'editada' }).where(sql`${transferencias.id} = ${t!.id}`), tenantA),
    ).rejects.toThrow(/inmutable/i);
  });

  it('posición consolidada: la caja USD refleja el ingreso de $40 derivado del ledger', async () => {
    const pos = await como(tenantA, () => posicion.consolidada(companyA));
    const cajaUsd = pos.cuentas.find((c) => c.codigo === '1.1.02');
    expect(Number(cajaUsd?.saldoUsd)).toBeCloseTo(40, 2);
  });

  it('cierre de caja — caso 5: el esperado por método neto del vuelto, faltante a 6.8', async () => {
    // Turno con un cobro: Pago Móvil 10.000 entró y 500 salió como vuelto → esperado 9.500.
    const cobroId = randomUUID();
    await tdb.ownerSql`insert into cobros (id, tenant_id, company_id, fecha, fecha_fiscal, status) values
      (${cobroId}, ${tenantA}, ${companyA}, '2026-06-12T15:00:00Z', '2026-06-12', 'POSTED')`;
    const pm = await tdb.ownerSql<{ id: string }[]>`select id from payment_methods where company_id = ${companyA} and codigo = 'PAGO_MOVIL'`;
    const pmId = pm[0]!.id;
    await tdb.ownerSql`insert into cobro_medios (id, tenant_id, company_id, cobro_id, payment_method_id, moneda, monto_origen, monto_ves, monto_usd_mgmt, causa_igtf, es_vuelto) values
      (${randomUUID()}, ${tenantA}, ${companyA}, ${cobroId}, ${pmId}, 'VES', 10000, 10000, 40, false, false),
      (${randomUUID()}, ${tenantA}, ${companyA}, ${cobroId}, ${pmId}, 'VES', 500, 500, 2, false, true)`;

    const abierto = await como(tenantA, () => cierres.abrir({ companyId: companyA, apertura: '2026-06-12T08:00:00Z' }));
    const cerrado = await como(tenantA, () =>
      cierres.cerrar({
        cierreId: abierto.id,
        companyId: companyA,
        cierre: '2026-06-12T20:00:00Z',
        rateUsdMgmt: '250',
        conteos: [{ paymentMethodId: pmId, montoDeclarado: '9450' }], // faltante 50 vs esperado 9.500
      }),
    );
    expect(cerrado.cierre.status).toBe('CERRADO');
    const arq = cerrado.arqueos.find((a) => a.paymentMethodId === pmId);
    expect(Number(arq?.montoSistema)).toBeCloseTo(9500, 2);
    expect(Number(arq?.diferencia)).toBeCloseTo(-50, 2);
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string }[]>`
      select a.codigo, jl.dc from journal_lines jl join accounts a on a.id = jl.account_id where jl.entry_id = ${cerrado.cierre.journalEntryId!}`;
    expect(lineas.some((l) => l.codigo === '6.8' && l.dc === 'D')).toBe(true); // faltante
  });

  it('importador idempotente (caso 11): re-importar el mismo archivo no duplica líneas', async () => {
    const banco = await como(tenantA, () =>
      bancos.crear({ companyId: companyA, banco: 'BANESCO', nombre: 'Banesco Corriente', numeroMascara: '4321', moneda: 'VES', cuentaCodigo: '1.1.03' }),
    );
    const primera = await como(tenantA, () => importadores.importar({ companyId: companyA, bankAccountId: banco.id, archivoNombre: 'banesco.csv', contenido: BANESCO }));
    expect(primera.yaImportado).toBe(false);
    expect(primera.lineasInsertadas).toBe(6);

    const segunda = await como(tenantA, () => importadores.importar({ companyId: companyA, bankAccountId: banco.id, archivoNombre: 'banesco.csv', contenido: BANESCO }));
    expect(segunda.yaImportado).toBe(true);
    expect(segunda.lineasInsertadas).toBe(0);

    const total = await tdb.ownerSql<{ n: string }[]>`select count(*)::text as n from statement_lines where company_id = ${companyA}`;
    expect(Number(total[0]!.n)).toBe(6);
  });

  it('conciliación 1:1: empareja el abono del banco con la transferencia del sistema', async () => {
    // Transferencia caja→banco por 1.500 el 2026-05-02 (coincide con el primer abono del extracto Banesco).
    await como(tenantA, () =>
      transfers.registrar({
        companyId: companyA,
        fecha: '2026-05-02T13:00:00.000Z',
        descripcion: 'Depósito en banco',
        origen: { cuentaCodigo: '1.1.01', moneda: 'VES', monto: '1500', rateBcv: null },
        destino: { cuentaCodigo: '1.1.03', moneda: 'VES', monto: '1500', rateBcv: null },
        rateUsdMgmt: '250',
      }),
    );
    const banco = await tdb.ownerSql<{ id: string }[]>`select id from bank_accounts where company_id = ${companyA} and banco = 'BANESCO'`;
    const bankAccountId = banco[0]!.id;

    const sug = await como(tenantA, () => conciliacion.sugerir(companyA, bankAccountId));
    const match = sug.sugerencias.find((s) => s.tipo === 'UNO_A_UNO');
    expect(match).toBeDefined();

    const res = await como(tenantA, () =>
      conciliacion.conciliar({
        companyId: companyA,
        bankAccountId,
        grupos: [{ tipo: match!.tipo, score: String(match!.score), statementLineIds: match!.bancoIds, journalLineIds: match!.sistemaIds }],
      }),
    );
    expect(res.filas).toBeGreaterThanOrEqual(1);
    const conciliada = await withTenant(tdb.appDb, (tx) => tx.select().from(statementLines).where(sql`${statementLines.id} = ${match!.bancoIds[0]!}`), tenantA);
    expect(conciliada[0]!.estado).toBe('CONCILIADO');
  });

  it('revaluación idempotente (caso 11): re-ejecutar no duplica el ajuste; postea ajuste + reverso', async () => {
    const primera = await como(tenantA, () => revaluacion.ejecutar({ companyId: companyA, anio: 2026, mes: 6, rateCierre: '270' }));
    expect(primera.yaEjecutada).toBe(false);
    expect(primera.revaluacion.journalEntryId).not.toBeNull();
    expect(primera.revaluacion.reversoEntryId).not.toBeNull();

    const segunda = await como(tenantA, () => revaluacion.ejecutar({ companyId: companyA, anio: 2026, mes: 6, rateCierre: '270' }));
    expect(segunda.yaEjecutada).toBe(true);
    expect(segunda.revaluacion.id).toBe(primera.revaluacion.id);

    const total = await tdb.ownerSql<{ n: string }[]>`select count(*)::text as n from revaluaciones where company_id = ${companyA} and anio = 2026 and mes = 6`;
    expect(Number(total[0]!.n)).toBe(1);
  });

  it('aislamiento RLS: el tenant B no ve las transferencias ni revaluaciones del tenant A', async () => {
    const tB = await withTenant(tdb.appDb, (tx) => tx.select().from(transferencias), tenantB);
    const rB = await withTenant(tdb.appDb, (tx) => tx.select().from(revaluaciones), tenantB);
    expect(tB).toHaveLength(0);
    expect(rB).toHaveLength(0);
  });
});
