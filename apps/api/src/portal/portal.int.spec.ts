import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif, periodoFiscal } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import { CierreMensualService } from '../contabilidad/cierre-mensual.service';
import type { DatabaseService } from '../db/database.service';
import { RevaluacionService } from '../tesoreria/revaluacion.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { DelegacionesService } from './delegaciones.service';
import { etiquetaPeriodo, periodoAnterior } from './obligaciones';
import { PortalService } from './portal.service';

/**
 * Integración del Portal del contador (P16) contra Postgres real (testcontainers): agregación
 * tenant-level de la cartera (panel, calendario), aislamiento RLS entre carteras de tenants
 * distintos y ciclo de vida de las delegaciones (otorgar/upsert/revocar). Requiere Docker → CI.
 */
describe('Portal del contador — integración DB (P16)', () => {
  let tdb: TestDatabase;
  let portal: PortalService;
  let delegaciones: DelegacionesService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ownerA = randomUUID();
  const contador = randomUUID();
  const companyA1 = randomUUID(); // ordinario
  const companyA2 = randomUUID(); // SPE
  const companyB1 = randomUUID();

  // Período actual y anterior según el reloj de corrida (el servicio usa new Date()).
  const actual = periodoFiscal(new Date());
  const previo = periodoAnterior(actual.anio, actual.mes);

  function rif(letra: string, ocho: string): string {
    return `${letra}-${ocho}-${calcularDigitoVerificadorRif(letra, ocho)}`;
  }
  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: ownerA, ip: undefined, device: undefined };
  }
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    const cierre = new CierreMensualService(database, audit, new RevaluacionService(database, audit));
    portal = new PortalService(database, cierre);
    delegaciones = new DelegacionesService(database, audit);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Contador A', 'contador-a'), (${tenantB}, 'Contador B', 'contador-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values
      (${ownerA}, 'owner@a.com', 'Dueño A'), (${contador}, 'contador@a.com', 'Contador')`;

    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, tipo_contribuyente, spe) values
      (${companyA1}, ${tenantA}, ${rif('J', '00000001')}, 'Ordinaria C.A.', 'ORDINARIO', false),
      (${companyA2}, ${tenantA}, ${rif('J', '00000002')}, 'Especial C.A.', 'ESPECIAL', true),
      (${companyB1}, ${tenantB}, ${rif('J', '00000003')}, 'Ajena C.A.', 'ORDINARIO', false)`;

    // companyA1: período anterior CERRADO + actual ABIERTO. companyA2: solo actual ABIERTO.
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA1}, ${previo.anio}, ${previo.mes}, 'CLOSED'),
      (${randomUUID()}, ${tenantA}, ${companyA1}, ${actual.anio}, ${actual.mes}, 'OPEN'),
      (${randomUUID()}, ${tenantA}, ${companyA2}, ${actual.anio}, ${actual.mes}, 'OPEN')`;

    // Declaración de IVA del período anterior PRESENTADA para companyA1.
    await tdb.ownerSql`insert into tax_returns (id, tenant_id, company_id, tipo, periodo_anio, periodo_mes, status) values
      (${randomUUID()}, ${tenantA}, ${companyA1}, 'IVA', ${previo.anio}, ${previo.mes}, 'PRESENTADA')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('panel: agrega solo las empresas del tenant en contexto (aislamiento RLS)', async () => {
    const panelA = await como(tenantA, () => portal.panel());
    expect(panelA.empresas.map((e) => e.companyId).sort()).toEqual([companyA1, companyA2].sort());
    expect(panelA.totales.empresas).toBe(2);

    const panelB = await como(tenantB, () => portal.panel());
    expect(panelB.empresas.map((e) => e.companyId)).toEqual([companyB1]);
  });

  it('panel: estado de cierres derivado de los períodos', async () => {
    const panelA = await como(tenantA, () => portal.panel());
    const a1 = panelA.empresas.find((e) => e.companyId === companyA1)!;
    expect(a1.cierre.ultimoCerrado).toBe(etiquetaPeriodo(previo.anio, previo.mes));
    expect(a1.cierre.estadoActual).toBe('OPEN');
    expect(a1.cierre.periodosAbiertos).toBe(1);

    const a2 = panelA.empresas.find((e) => e.companyId === companyA2)!;
    expect(a2.cierre.ultimoCerrado).toBeNull();
  });

  it('panel: la declaración presentada marca esa obligación y no cuenta como pendiente', async () => {
    const panelA = await como(tenantA, () => portal.panel());
    const a1 = panelA.empresas.find((e) => e.companyId === companyA1)!;
    // Ventana [previo, actual]: IVA previo está PRESENTADA → solo el IVA actual queda pendiente.
    expect(a1.obligaciones.pendientes).toBe(1);
    expect(a1.obligaciones.proxima?.periodo).toBe(etiquetaPeriodo(actual.anio, actual.mes));
  });

  it('calendario: el SPE suma IGTF; el ordinario solo IVA', async () => {
    const cal = await como(tenantA, () => portal.calendario());
    const tiposA2 = cal.obligaciones.filter((o) => o.companyId === companyA2).map((o) => o.tipo);
    expect(tiposA2).toContain('IGTF');
    const tiposA1 = cal.obligaciones.filter((o) => o.companyId === companyA1).map((o) => o.tipo);
    expect(new Set(tiposA1)).toEqual(new Set(['IVA']));
    // Ordenado por fecha límite ascendente.
    const fechas = cal.obligaciones.map((o) => o.fechaLimite);
    expect(fechas).toEqual([...fechas].sort());
  });

  it('checklist masivo: una fila por empresa de la cartera con sus pasos', async () => {
    const chk = await como(tenantA, () => portal.checklistMasivo({ anio: actual.anio, mes: actual.mes }));
    expect(chk.empresas.map((e) => e.companyId).sort()).toEqual([companyA1, companyA2].sort());
    expect(chk.empresas.every((e) => e.pasos.length > 0)).toBe(true);
    expect(chk.totales.empresas).toBe(2);
  });

  it('delegaciones: otorgar, listar, reotorgar (upsert) y revocar; aislamiento entre tenants', async () => {
    const creada = await como(tenantA, () => delegaciones.otorgar({ companyId: companyA1, userId: contador, permisos: ['portal.view', 'contabilidad.cerrar'] }));
    expect(creada.estado).toBe('ACTIVA');
    expect(creada.permisos).toEqual(['portal.view', 'contabilidad.cerrar']);

    const listaA = await como(tenantA, () => delegaciones.listar());
    expect(listaA).toHaveLength(1);

    // Otro tenant no ve la delegación (RLS).
    const listaB = await como(tenantB, () => delegaciones.listar());
    expect(listaB).toHaveLength(0);

    // Reotorgar (mismo company+user) actualiza permisos sin duplicar fila.
    const reotorgada = await como(tenantA, () => delegaciones.otorgar({ companyId: companyA1, userId: contador, permisos: ['portal.view'] }));
    expect(reotorgada.id).toBe(creada.id);
    expect(reotorgada.permisos).toEqual(['portal.view']);

    const revocada = await como(tenantA, () => delegaciones.revocar({ id: creada.id }));
    expect(revocada.estado).toBe('REVOCADA');
    expect(revocada.revokedAt).not.toBeNull();
  });
});
