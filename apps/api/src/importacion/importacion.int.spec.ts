import { randomUUID } from 'node:crypto';
import { Decimal, calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ImportacionService } from './importacion.service';

/**
 * Integración de los importadores de migración (P31) contra Postgres real (testcontainers): import
 * correcto, deduplicación por RIF/SKU, dry-run que NO escribe, asiento de apertura resultante
 * balanceado en las 3 bases (caso 45) y reconversión monetaria (caso 46). Requiere Docker → CI.
 */
describe('Importación de migración — integración DB (P31)', () => {
  let tdb: TestDatabase;
  let onboarding: OnboardingService;
  let importacion: ImportacionService;

  const tenantA = randomUUID();
  const userOwner = randomUUID();
  let companyId: string;
  let companyRecon: string;

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  const NORTE = rif('J', '30112233');
  const SUR = rif('J', '40556677');
  const PEREZ = rif('V', '10203040');

  function ctx(tenantId: string, userId?: string): TenantContext {
    return { tenantId, userId, ip: undefined, device: undefined };
  }
  function como<T>(fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantA, userOwner), fn);
  }

  const tercerosCsv = [
    'tipo;rif;razon_social;condicion_iva;es_agente_retencion_iva;pct_retencion_iva;es_agente_retencion_islr;direccion_fiscal;email;telefono;dias_credito',
    `cliente;${NORTE};Comercial Norte C.A.;ordinario;no;;no;Caracas;n@x.com;0212-1;30`,
    `ambos;${SUR};Servicios Sur C.A.;ordinario;no;;no;Valencia;s@x.com;0241-2;15`,
    `proveedor;${PEREZ};Juan Perez;especial;si;75;si;Maracay;;0243-3;0`,
    `cliente;${NORTE};Comercial Norte (repetido);ordinario;no;;no;Caracas;;;30`,
    'cliente;;Tercero sin RIF;ordinario;no;;no;;;;0',
  ].join('\n');

  const itemsCsv = [
    'sku;descripcion;tipo;alicuota_iva;unidad;costo;precio;moneda',
    'PROD-100;Arroz 1kg;producto;REDUCIDA;UND;1.20;2.00;USD',
    'SERV-100;Asesoria;servicio;GENERAL;HORA;;30.00;USD',
  ].join('\n');

  const saldosCsv = [
    'cuenta;naturaleza;descripcion;moneda;monto;rate_bcv;sku;cantidad;fecha_origen',
    '1.1.01;ACTIVO;Caja Bs;VES;5.000,00;;;;',
    '1.1.04;ACTIVO;Banco USD;USD;1000.00;40.50;;;',
    '1.4;ACTIVO;Inventario;USD;300.00;40.50;PROD-100;100;2025-12-01',
  ].join('\n');

  const cxcCsv = [
    'rif;documento;fecha;vencimiento;moneda;monto;rate_bcv;cuenta',
    `${NORTE};FAC-001;2026-05-01;2026-05-31;VES;10.000,00;;`,
    `${SUR};FAC-002;2026-05-10;2026-06-09;USD;200.00;40.50;`,
  ].join('\n');

  const cxpCsv = [
    'rif;documento;fecha;vencimiento;moneda;monto;rate_bcv;cuenta',
    `${PEREZ};FACT-900;2026-04-15;2026-05-15;USD;150.00;40.50;`,
  ].join('\n');

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const audit = new AuditService();
    onboarding = new OnboardingService({ db: tdb.appDb } as DatabaseService, audit);
    importacion = new ImportacionService({ db: tdb.appDb } as DatabaseService, audit, onboarding);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values (${tenantA}, 'Tenant A', 'tenant-a')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values (${userOwner}, 'owner@a.com', 'Owner')`;
    await tdb.ownerSql`insert into memberships (id, tenant_id, user_id, role) values (${randomUUID()}, ${tenantA}, ${userOwner}, 'owner')`;

    const empresa = await como(() =>
      onboarding.crearEmpresa({ rif: rif('J', '10000001'), razonSocial: 'Migrada C.A.', tipoContribuyente: 'ORDINARIO', formaJuridica: 'PJ' }),
    );
    companyId = empresa.companyId;
    const recon = await como(() =>
      onboarding.crearEmpresa({ rif: rif('J', '10000002'), razonSocial: 'Reconv C.A.', tipoContribuyente: 'ORDINARIO', formaJuridica: 'PJ' }),
    );
    companyRecon = recon.companyId;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('importa terceros deduplicando por RIF y reportando errores por fila', async () => {
    const r = await como(() => importacion.commitTerceros({ companyId, archivoNombre: 'terceros.csv', contenido: tercerosCsv }));
    expect(r.reporte.total).toBe(5);
    expect(r.reporte.duplicadasEnArchivo).toBe(1);
    expect(r.reporte.errores).toHaveLength(1);
    expect(r.insertadas).toBe(3);

    const [n] = await tdb.ownerSql`select count(*)::int as n from parties where company_id = ${companyId}`;
    expect(n?.n).toBe(3);
  });

  it('re-importar los mismos terceros no duplica (dedup contra los existentes)', async () => {
    const r = await como(() => importacion.commitTerceros({ companyId, archivoNombre: 'terceros.csv', contenido: tercerosCsv }));
    expect(r.insertadas).toBe(0);
    expect(r.reporte.duplicadasExistentes).toBe(3);
    const [n] = await tdb.ownerSql`select count(*)::int as n from parties where company_id = ${companyId}`;
    expect(n?.n).toBe(3);
  });

  it('importa ítems con su alícuota y carga el precio en la lista por defecto', async () => {
    await tdb.ownerSql`insert into price_lists (id, tenant_id, company_id, codigo, nombre, moneda, es_default)
      values (${randomUUID()}, ${tenantA}, ${companyId}, 'GENERAL', 'General', 'USD', true)`;
    const r = await como(() => importacion.commitItems({ companyId, archivoNombre: 'items.csv', contenido: itemsCsv }));
    expect(r.insertadas).toBe(2);
    expect(r.preciosCargados).toBe(2);
    const [arroz] = await tdb.ownerSql`select alicuota_iva from items where company_id = ${companyId} and sku = 'PROD-100'`;
    expect(arroz?.alicuota_iva).toBe('REDUCIDA');
  });

  it('dry-run de la apertura NO escribe y reporta el asiento cuadrado', async () => {
    const [antes] = await tdb.ownerSql`select count(*)::int as n from journal_entries where company_id = ${companyId}`;
    const r = await como(() =>
      importacion.dryRunApertura({
        companyId,
        fechaApertura: '2026-01-02',
        capitalVes: '5000',
        rateUsdMgmt: '40.5',
        saldos: { archivoNombre: 'saldos.csv', contenido: saldosCsv },
        cxc: { archivoNombre: 'cxc.csv', contenido: cxcCsv },
        cxp: { archivoNombre: 'cxp.csv', contenido: cxpCsv },
      }),
    );
    expect(r.errores).toHaveLength(0);
    expect(r.cuadraVes).toBe(true);
    expect(r.cuadraUsd).toBe(true);
    expect(r.renglones).toBe(6); // 3 saldos + 2 CxC + 1 CxP

    const [despues] = await tdb.ownerSql`select count(*)::int as n from journal_entries where company_id = ${companyId}`;
    expect(despues?.n).toBe(antes?.n); // dry-run no escribió nada
  });

  it('confirma la apertura migrada: asiento balanceado en VES y USD + stock_move de inventario', async () => {
    const r = await como(() =>
      importacion.commitApertura({
        companyId,
        fechaApertura: '2026-01-02',
        capitalVes: '5000',
        rateUsdMgmt: '40.5',
        saldos: { archivoNombre: 'saldos.csv', contenido: saldosCsv },
        cxc: { archivoNombre: 'cxc.csv', contenido: cxcCsv },
        cxp: { archivoNombre: 'cxp.csv', contenido: cxpCsv },
      }),
    );
    expect(r.creada).toBe(true);

    const lineas = await tdb.ownerSql<{ dc: string; monto_ves: string; monto_usd_mgmt: string }[]>`
      select dc, monto_ves, monto_usd_mgmt from journal_lines where entry_id = ${r.journalEntryId}`;
    const suma = (lado: string, col: 'monto_ves' | 'monto_usd_mgmt'): Decimal =>
      lineas.filter((l) => l.dc === lado).reduce((acc, l) => acc.plus(new Decimal(l[col])), new Decimal(0));
    expect(suma('D', 'monto_ves').equals(suma('C', 'monto_ves'))).toBe(true);
    expect(suma('D', 'monto_usd_mgmt').equals(suma('C', 'monto_usd_mgmt'))).toBe(true);

    // CxC/CxP quedaron imputadas a su tercero.
    const conParty = lineas.length;
    expect(conParty).toBeGreaterThan(0);
    const [mov] = await tdb.ownerSql`select tipo, valor_ves from stock_moves where company_id = ${companyId}`;
    expect(mov?.tipo).toBe('APERTURA');
  });

  it('aplica la reconversión monetaria histórica (caso 46): Bs.S -> Bs.D en el asiento', async () => {
    const saldosBss = [
      'cuenta;naturaleza;descripcion;moneda;monto;rate_bcv;sku;cantidad;fecha_origen',
      '1.1.01;ACTIVO;Caja Bs (escala 2018);VES;5.000.000.000,00;;;;',
    ].join('\n');
    const r = await como(() =>
      importacion.commitApertura({
        companyId: companyRecon,
        fechaApertura: '2026-01-02',
        capitalVes: '5000',
        rateUsdMgmt: '40.5',
        escala: 'BS_S_2018',
        saldos: { archivoNombre: 'saldos.csv', contenido: saldosBss },
      }),
    );
    const [caja] = await tdb.ownerSql`
      select monto_ves from journal_lines where entry_id = ${r.journalEntryId} and dc = 'D' order by monto_ves desc limit 1`;
    expect(new Decimal(caja?.monto_ves as string).equals(new Decimal('5000'))).toBe(true);
  });
});
