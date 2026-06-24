import { randomUUID } from 'node:crypto';
import { Decimal, calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { OnboardingService } from './onboarding.service';

/**
 * Integración del onboarding (P30) contra Postgres real (testcontainers): alta de empresa con
 * inferencia de perfil (docs/02 §1), precarga completa (plan, almacén, métodos de pago, series,
 * plantillas, período), asiento de apertura balanceado en las 3 bases (regla 7/10, caso 45),
 * multi-empresa aislada (regla 12) e idempotencia. Requiere Docker → CI.
 */
describe('Onboarding — integración DB (P30)', () => {
  let tdb: TestDatabase;
  let onboarding: OnboardingService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userOwner = randomUUID();

  let companyOrd: string;
  let companySpe: string;
  let entryIdApertura: string;

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
    onboarding = new OnboardingService({ db: tdb.appDb } as DatabaseService, new AuditService());

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userOwner}, 'owner@a.com', 'Owner')`;
    await tdb.ownerSql`insert into memberships (id, tenant_id, user_id, role) values
      (${randomUUID()}, ${tenantA}, ${userOwner}, 'owner')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('da de alta una empresa ordinaria con precarga completa', async () => {
    const r = await como(
      tenantA,
      () =>
        onboarding.crearEmpresa({
          rif: rif('J', '10000001'),
          razonSocial: 'Acme C.A.',
          direccionFiscal: 'Av. 1, Caracas',
          tipoContribuyente: 'ORDINARIO',
          formaJuridica: 'PJ',
        }),
      userOwner,
    );
    companyOrd = r.companyId;

    expect(r.creada).toBe(true);
    expect(r.perfil.esSpe).toBe(false);
    expect(r.perfil.alicuotaIslrPj).toBe(34);
    expect(r.precarga.cuentas).toBeGreaterThan(0);
    expect(r.precarga.almacenes).toBe(1);
    expect(r.precarga.metodosPago).toBe(7);
    expect(r.precarga.series).toBe(4); // FACTURA, NC, ND, GUIA (ordinario: sin retención)
    expect(r.precarga.plantillas).toBe(3);
    expect(r.precarga.periodos).toBe(1);

    const [empresa] = await tdb.ownerSql`select spe, tipo_contribuyente from companies where id = ${companyOrd}`;
    expect(empresa?.spe).toBe(false);
    expect(empresa?.tipo_contribuyente).toBe('ORDINARIO');
  });

  it('infiere SPE: spe=true, series de retención precargadas y divisas que causan IGTF', async () => {
    const r = await como(
      tenantA,
      () =>
        onboarding.crearEmpresa({
          rif: rif('J', '10000002'),
          razonSocial: 'Especial C.A.',
          direccionFiscal: 'Av. 2, Caracas',
          tipoContribuyente: 'ESPECIAL',
          formaJuridica: 'PJ',
        }),
      userOwner,
    );
    companySpe = r.companyId;

    expect(r.perfil.esSpe).toBe(true);
    expect(r.perfil.percibeIgtf).toBe(true);
    expect(r.precarga.series).toBe(6); // 4 + COMPROBANTE_RETENCION_IVA + _ISLR

    const [empresa] = await tdb.ownerSql`select spe from companies where id = ${companySpe}`;
    expect(empresa?.spe).toBe(true);
    const usd = await tdb.ownerSql`select causa_igtf from payment_methods where company_id = ${companySpe} and codigo = 'EFECTIVO_USD'`;
    expect(usd[0]?.causa_igtf).toBe(true);
    const bs = await tdb.ownerSql`select causa_igtf from payment_methods where company_id = ${companySpe} and codigo = 'EFECTIVO_BS'`;
    expect(bs[0]?.causa_igtf).toBe(false);
  });

  it('infiere el perfil sin escribir (preview): formal no cobra IVA', async () => {
    const [antes] = await tdb.ownerSql`select count(*)::int as n from companies`;
    const inf = await como(tenantA, async () =>
      onboarding.inferir({
        rif: rif('J', '10000003'),
        razonSocial: 'Formal C.A.',
        tipoContribuyente: 'FORMAL',
        formaJuridica: 'PN',
      }),
    );
    expect(inf.rifValido).toBe(true);
    expect(inf.perfil.cobraIva).toBe(false);
    const [despues] = await tdb.ownerSql`select count(*)::int as n from companies`;
    expect(despues?.n).toBe(antes?.n); // no creó ninguna empresa
  });

  it('registra los saldos iniciales: asiento de apertura cuadra en VES/USD y crea el stock_move', async () => {
    const itemId = randomUUID();
    await tdb.ownerSql`insert into items (id, tenant_id, company_id, sku, descripcion, tipo) values
      (${itemId}, ${tenantA}, ${companyOrd}, 'SKU-1', 'Producto 1', 'producto')`;

    const r = await como(
      tenantA,
      () =>
        onboarding.registrarSaldosIniciales({
          companyId: companyOrd,
          fechaApertura: '2026-01-02',
          capitalVes: '5000',
          rateUsdMgmt: '40',
          renglones: [
            { naturaleza: 'ACTIVO', cuenta: '1.1.01', moneda: 'VES', montoOrigen: '3000' },
            { naturaleza: 'ACTIVO', cuenta: '1.1.04', moneda: 'USD', montoOrigen: '100', rateBcv: '40' },
            {
              naturaleza: 'ACTIVO',
              cuenta: '1.4',
              moneda: 'VES',
              montoOrigen: '2000',
              itemId,
              cantidad: '50',
              fechaOrigen: '2025-12-01',
            },
          ],
        }),
      userOwner,
    );
    entryIdApertura = r.journalEntryId;
    expect(r.creada).toBe(true);

    // El asiento cuadra en la base fiscal VES y en la gerencial USD.
    const lineas = await tdb.ownerSql<{ dc: string; monto_ves: string; monto_usd_mgmt: string }[]>`
      select dc, monto_ves, monto_usd_mgmt from journal_lines where entry_id = ${entryIdApertura}`;
    const suma = (lado: string, col: 'monto_ves' | 'monto_usd_mgmt'): Decimal =>
      lineas.filter((l) => l.dc === lado).reduce((acc, l) => acc.plus(new Decimal(l[col])), new Decimal(0));
    expect(suma('D', 'monto_ves').equals(suma('C', 'monto_ves'))).toBe(true);
    expect(suma('D', 'monto_usd_mgmt').equals(suma('C', 'monto_usd_mgmt'))).toBe(true);

    // El estado del asiento es POSTED (inmutable).
    const [entry] = await tdb.ownerSql`select estado from journal_entries where id = ${entryIdApertura}`;
    expect(entry?.estado).toBe('POSTED');

    // Movimiento de inventario de apertura (kardex), con su fecha de origen.
    const moves = await tdb.ownerSql`select tipo, cantidad, valor_ves, fecha_fiscal from stock_moves where company_id = ${companyOrd}`;
    expect(moves).toHaveLength(1);
    expect(moves[0]?.tipo).toBe('APERTURA');
    expect(new Decimal(moves[0]?.valor_ves as string).equals(new Decimal('2000'))).toBe(true);

    // Marcador de apertura registrado.
    const [apertura] = await tdb.ownerSql`select journal_entry_id from company_aperturas where company_id = ${companyOrd}`;
    expect(apertura?.journal_entry_id).toBe(entryIdApertura);
  });

  it('es idempotente: re-crear la empresa y re-registrar la apertura no duplican', async () => {
    const [antesCuentas] = await tdb.ownerSql`select count(*)::int as n from accounts where company_id = ${companyOrd}`;

    const reCrear = await como(
      tenantA,
      () =>
        onboarding.crearEmpresa({
          rif: rif('J', '10000001'),
          razonSocial: 'Acme C.A.',
          tipoContribuyente: 'ORDINARIO',
          formaJuridica: 'PJ',
        }),
      userOwner,
    );
    expect(reCrear.creada).toBe(false);
    expect(reCrear.companyId).toBe(companyOrd);

    const [despuesCuentas] = await tdb.ownerSql`select count(*)::int as n from accounts where company_id = ${companyOrd}`;
    expect(despuesCuentas?.n).toBe(antesCuentas?.n); // no re-sembró cuentas

    const reApertura = await como(
      tenantA,
      () =>
        onboarding.registrarSaldosIniciales({
          companyId: companyOrd,
          fechaApertura: '2026-01-02',
          capitalVes: '5000',
          rateUsdMgmt: '40',
          renglones: [{ naturaleza: 'ACTIVO', cuenta: '1.1.01', moneda: 'VES', montoOrigen: '3000' }],
        }),
      userOwner,
    );
    expect(reApertura.creada).toBe(false);
    expect(reApertura.journalEntryId).toBe(entryIdApertura);

    const aperturas = await tdb.ownerSql`select id from company_aperturas where company_id = ${companyOrd}`;
    expect(aperturas).toHaveLength(1);
  });

  it('aísla las empresas entre tenants (RLS, regla 12): el tenant B no ve la del tenant A', async () => {
    await expect(como(tenantB, () => onboarding.estado(companyOrd))).rejects.toThrow();

    // Dentro del tenant A, cada empresa tiene su propio plan (multi-empresa aislada).
    const [planOrd] = await tdb.ownerSql`select count(*)::int as n from accounts where company_id = ${companyOrd}`;
    const [planSpe] = await tdb.ownerSql`select count(*)::int as n from accounts where company_id = ${companySpe}`;
    expect(planOrd?.n).toBeGreaterThan(0);
    expect(planSpe?.n).toBe(planOrd?.n);
  });
});
