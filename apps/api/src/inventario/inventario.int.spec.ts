import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { stockMoves } from '../db/schema';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { AjustesService } from './ajustes.service';
import { AlertasService } from './alertas.service';
import { ConteosService } from './conteos.service';
import { MovimientosService } from './movimientos.service';
import { PreciosService } from './precios.service';
import { TrasladosService } from './traslados.service';

/**
 * Integración de inventario (P12) contra Postgres real (testcontainers): costo promedio en doble base
 * con compras en monedas distintas (caso 37), venta al promedio / en negativo (caso 38), ajuste con
 * aprobación y separación de deberes (caso 40), traslado con tránsito (caso 41), precios masivos y
 * alerta de margen negativo, append-only del kardex (regla 4) y aislamiento RLS. Requiere Docker → CI.
 */
describe('Inventario — integración DB (P12)', () => {
  let tdb: TestDatabase;
  let movimientos: MovimientosService;
  let ajustes: AjustesService;
  let traslados: TrasladosService;
  let conteos: ConteosService;
  let precios: PreciosService;
  let alertas: AlertasService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const w1 = randomUUID();
  const w2 = randomUUID();
  const p1 = randomUUID(); // producto con costo promedio
  const p2 = randomUUID(); // producto para margen negativo
  const p3 = randomUUID(); // producto para venta en negativo
  const listaUsd = randomUUID();
  const userCrea = randomUUID();
  const userAprueba = randomUUID();
  const FECHA = '2026-06-12T14:00:00.000Z';

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
    movimientos = new MovimientosService(database, new AuditService());
    ajustes = new AjustesService(database, new AuditService());
    traslados = new TrasladosService(database, new AuditService());
    conteos = new ConteosService(database, new AuditService());
    precios = new PreciosService(database, new AuditService());
    alertas = new AlertasService(database);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values
      (${userCrea}, 'crea@a.com', 'Crea'), (${userAprueba}, 'aprueba@a.com', 'Aprueba')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social, direccion_fiscal) values
      (${companyA}, ${tenantA}, ${rif('J', '00000001')}, 'Inventario C.A.', 'Av. Principal, Caracas')`;
    await tdb.ownerSql`insert into periods (id, tenant_id, company_id, anio, mes, estado) values
      (${randomUUID()}, ${tenantA}, ${companyA}, 2026, 6, 'OPEN')`;
    await tdb.ownerSql`insert into warehouses (id, tenant_id, company_id, codigo, nombre) values
      (${w1}, ${tenantA}, ${companyA}, 'W1', 'Caracas'),
      (${w2}, ${tenantA}, ${companyA}, 'W2', 'Valencia')`;
    await tdb.ownerSql`insert into items (id, tenant_id, company_id, sku, descripcion, tipo) values
      (${p1}, ${tenantA}, ${companyA}, 'P1', 'Producto 1', 'producto'),
      (${p2}, ${tenantA}, ${companyA}, 'P2', 'Producto 2', 'producto'),
      (${p3}, ${tenantA}, ${companyA}, 'P3', 'Producto 3', 'producto')`;
    await tdb.ownerSql`insert into price_lists (id, tenant_id, company_id, codigo, nombre, moneda, es_default) values
      (${listaUsd}, ${tenantA}, ${companyA}, 'GEN', 'General USD', 'USD', true)`;

    await withTenant(
      tdb.appDb,
      (tx) => seedPlanDeCuentas(tx, { tenantId: tenantA, companyId: companyA }),
      tenantA,
    );
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  it('caso 37 — costo promedio doble base con compras en monedas distintas (Bs 2750 / USD 10,55555556)', async () => {
    await como(tenantA, () =>
      movimientos.entrada({
        companyId: companyA,
        warehouseId: w1,
        itemId: p1,
        cantidad: '10',
        costoMoneda: 'USD',
        costoUnit: '10',
        rateBcv: '250',
        fecha: FECHA,
      }),
    );
    await como(tenantA, () =>
      movimientos.entrada({
        companyId: companyA,
        warehouseId: w1,
        itemId: p1,
        cantidad: '10',
        costoMoneda: 'VES',
        costoUnit: '3000',
        rateBcv: '270',
        fecha: FECHA,
      }),
    );

    const { costo } = await como(tenantA, () => movimientos.kardex(companyA, p1));
    expect(costo.saldoCantidad).toBe('20');
    expect(costo.costoPromedioVes).toBe('2750.00000000');
    expect(costo.costoPromedioUsd).toBe('10.55555556');

    const ex = await como(tenantA, () => movimientos.existencia(companyA, p1, w1));
    expect(ex.cantidad).toBe('20');
    expect(Number(ex.valorVes)).toBeCloseTo(55000, 2);

    // La entrada generó asiento D 1.4 Inventarios / C 2.1 Proveedores.
    const lineas = await tdb.ownerSql<{ codigo: string; dc: string }[]>`
      select a.codigo, jl.dc from journal_lines jl join accounts a on a.id = jl.account_id
      join stock_moves sm on sm.journal_entry_id = jl.entry_id
      where sm.item_id = ${p1} and sm.tipo = 'COMPRA' limit 10`;
    expect(lineas.find((l) => l.codigo === '1.4')?.dc).toBe('D');
    expect(lineas.find((l) => l.codigo === '2.1')?.dc).toBe('C');
  });

  it('caso 38 — venta sale al promedio (COGS D 5.1 / C 1.4); el promedio no cambia', async () => {
    const mov = await como(tenantA, () =>
      movimientos.venta({
        companyId: companyA,
        warehouseId: w1,
        itemId: p1,
        cantidad: '5',
        fecha: FECHA,
      }),
    );
    expect(mov.costoUnitVes).toBe('2750.00000000');
    expect(mov.saldoCantidad).toBe('15.0000'); // numeric(20,4) → escala fija
    expect(mov.costoPromedioUsd).toBe('10.55555556');

    const lineas = await tdb.ownerSql<{ codigo: string; dc: string }[]>`
      select a.codigo, jl.dc from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.entry_id = ${mov.journalEntryId!}`;
    expect(lineas.find((l) => l.codigo === '5.1')?.dc).toBe('D');
    expect(lineas.find((l) => l.codigo === '1.4')?.dc).toBe('C');
  });

  it('caso 38 — venta con stock 0 bloqueada por defecto; permitida en negativo al último promedio', async () => {
    await expect(
      como(tenantA, () =>
        movimientos.venta({
          companyId: companyA,
          warehouseId: w1,
          itemId: p3,
          cantidad: '1',
          fecha: FECHA,
        }),
      ),
    ).rejects.toThrow(/insuficiente/i);

    // Sembramos costo y permitimos negativo.
    await como(tenantA, () =>
      movimientos.entrada({
        companyId: companyA,
        warehouseId: w1,
        itemId: p3,
        cantidad: '2',
        costoMoneda: 'USD',
        costoUnit: '5',
        rateBcv: '40',
        fecha: FECHA,
      }),
    );
    const mov = await como(tenantA, () =>
      movimientos.venta({
        companyId: companyA,
        warehouseId: w1,
        itemId: p3,
        cantidad: '3',
        fecha: FECHA,
        permitirNegativo: true,
      }),
    );
    expect(mov.saldoCantidad).toBe('-1.0000');
    expect(mov.costoUnitUsd).toBe('5.00000000'); // último promedio
  });

  it('caso 40 — ajuste de merma: aprobación separada y asiento (no deducible → 6.8)', async () => {
    const creado = await como(
      tenantA,
      () =>
        ajustes.crear({
          companyId: companyA,
          tipo: 'MERMA',
          motivo: 'Rotura en almacén',
          deducible: false,
          fecha: FECHA,
          lineas: [{ itemId: p1, warehouseId: w1, direccion: 'SALIDA', cantidad: '2' }],
        }),
      userCrea,
    );
    expect(creado.ajuste.estado).toBe('PENDIENTE');

    // Separación de deberes: el mismo usuario no puede aprobar.
    await expect(
      como(tenantA, () => ajustes.aprobar({ ajusteId: creado.ajuste.id }), userCrea),
    ).rejects.toThrow(/separación|distinto/i);

    const aprobado = await como(
      tenantA,
      () => ajustes.aprobar({ ajusteId: creado.ajuste.id }),
      userAprueba,
    );
    expect(aprobado.ajuste.estado).toBe('APROBADO');
    expect(aprobado.ajuste.journalEntryId).not.toBeNull();

    const lineas = await tdb.ownerSql<{ codigo: string; dc: string }[]>`
      select a.codigo, jl.dc from journal_lines jl join accounts a on a.id = jl.account_id
      where jl.entry_id = ${aprobado.ajuste.journalEntryId!}`;
    expect(lineas.find((l) => l.codigo === '6.8')?.dc).toBe('D'); // gasto no deducible
    expect(lineas.find((l) => l.codigo === '1.4')?.dc).toBe('C');

    // Inmutabilidad del ajuste APROBADO (regla 4).
    await expect(
      tdb.ownerSql`update ajustes_inventario set motivo = 'x' where id = ${creado.ajuste.id}`,
    ).rejects.toThrow(/inmutable/i);
  });

  it('caso 41 — traslado con tránsito: no disponible en ninguno hasta recibir', async () => {
    // P1 en W1 tras compras(20) − venta(5) − merma(2) = 13.
    const desp = await como(tenantA, () =>
      traslados.despachar({
        companyId: companyA,
        origenWarehouseId: w1,
        destinoWarehouseId: w2,
        fecha: FECHA,
        lineas: [{ itemId: p1, cantidad: '4' }],
      }),
    );
    expect(desp.traslado.estado).toBe('EN_TRANSITO');

    // En tránsito: origen bajó a 9, destino aún 0 (no disponible en ninguno de los dos).
    const exW1 = await como(tenantA, () => movimientos.existencia(companyA, p1, w1));
    const exW2 = await como(tenantA, () => movimientos.existencia(companyA, p1, w2));
    expect(exW1.cantidad).toBe('9');
    expect(exW2.cantidad).toBe('0');

    const rec = await como(tenantA, () =>
      traslados.recibir({ trasladoId: desp.traslado.id, fecha: FECHA }),
    );
    expect(rec.traslado.estado).toBe('RECIBIDO');
    const exW2b = await como(tenantA, () => movimientos.existencia(companyA, p1, w2));
    expect(exW2b.cantidad).toBe('4');
    // El traslado es neutro a nivel de ítem: el costo promedio no cambió.
    const { costo } = await como(tenantA, () => movimientos.kardex(companyA, p1));
    expect(costo.costoPromedioVes).toBe('2750.00000000');
  });

  it('conteo físico: las diferencias generan un ajuste PENDIENTE', async () => {
    const abierto = await como(
      tenantA,
      () => conteos.abrir({ companyId: companyA, warehouseId: w2, itemIds: [p1], fecha: FECHA }),
      userCrea,
    );
    expect(abierto.lineas[0]!.cantidadSistema).toBe('4.0000');
    await como(
      tenantA,
      () =>
        conteos.capturar({
          conteoId: abierto.conteo.id,
          lineas: [{ itemId: p1, cantidadContada: '3' }],
        }),
      userCrea,
    );
    const cerrado = await como(
      tenantA,
      () => conteos.cerrar({ conteoId: abierto.conteo.id }),
      userCrea,
    );
    expect(cerrado.conteo.estado).toBe('CERRADO');
    expect(cerrado.ajusteId).not.toBeNull();
    const aj = await tdb.ownerSql<{ direccion: string; cantidad: string }[]>`
      select direccion, cantidad from ajuste_lineas where ajuste_id = ${cerrado.ajusteId!}`;
    expect(aj[0]!.direccion).toBe('SALIDA'); // contó 3 < sistema 4 → faltante
    expect(aj[0]!.cantidad).toBe('1.0000');
  });

  it('precios masivos por margen sobre costo + alerta de margen negativo en USD', async () => {
    // Precio de P2 deliberadamente bajo el costo: lo compramos a $20 y lo listamos a $15.
    await como(tenantA, () =>
      movimientos.entrada({
        companyId: companyA,
        warehouseId: w1,
        itemId: p2,
        cantidad: '1',
        costoMoneda: 'USD',
        costoUnit: '20',
        rateBcv: '40',
        fecha: FECHA,
      }),
    );
    await tdb.ownerSql`insert into item_prices (id, tenant_id, company_id, price_list_id, item_id, precio) values
      (${randomUUID()}, ${tenantA}, ${companyA}, ${listaUsd}, ${p2}, '15')`;

    const r = await como(tenantA, () => alertas.margenNegativo(companyA, '40', listaUsd));
    const alerta = r.alertas.find((a) => a.sku === 'P2');
    expect(alerta).toBeDefined();
    expect(alerta!.margenUsd).toBe('-5.0000');

    // Recosteo: subir al 20% sobre costo → $24, ya no hay margen negativo.
    const aplicado = await como(tenantA, () =>
      precios.aplicar({
        companyId: companyA,
        priceListId: listaUsd,
        modo: 'MARGEN_COSTO',
        valor: '20',
      }),
    );
    expect(aplicado.actualizados).toBe(1);
    const r2 = await como(tenantA, () => alertas.margenNegativo(companyA, '40', listaUsd));
    expect(r2.alertas.find((a) => a.sku === 'P2')).toBeUndefined();
  });

  it('append-only: un stock_move no admite UPDATE ni DELETE (regla 4)', async () => {
    const [row] = await tdb.ownerSql<
      { id: string }[]
    >`select id from stock_moves where item_id = ${p1} limit 1`;
    await expect(
      tdb.ownerSql`update stock_moves set cantidad = '999' where id = ${row!.id}`,
    ).rejects.toThrow(/append-only|inmutable/i);
    await expect(tdb.ownerSql`delete from stock_moves where id = ${row!.id}`).rejects.toThrow(
      /append-only|inmutable/i,
    );
  });

  it('aislamiento RLS: el tenant B no ve los movimientos del tenant A', async () => {
    const movsB = await withTenant(tdb.appDb, (tx) => tx.select().from(stockMoves), tenantB);
    expect(movsB).toHaveLength(0);
  });
});
