import { randomUUID } from 'node:crypto';
import { calcularDigitoVerificadorRif } from '@contave/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { ItemPricesService } from './item-prices.service';
import { ItemsService } from './items.service';
import { PartiesService } from './parties.service';
import { PaymentMethodsService } from './payment-methods.service';
import { SeriesService } from './series.service';

/**
 * Integración de maestros (P5) contra Postgres real (testcontainers): validación de RIF (caso 16),
 * aislamiento entre tenants (regla 12, caso 55), integridad cross-company (cuenta del método de
 * pago, empresa del tercero), unicidad de series (regla 6) y upsert de precios. Requiere Docker → CI.
 */
describe('Maestros — integración DB (P5)', () => {
  let tdb: TestDatabase;
  let parties: PartiesService;
  let items: ItemsService;
  let itemPrices: ItemPricesService;
  let paymentMethods: PaymentMethodsService;
  let series: SeriesService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const cuentaMovimientoA = randomUUID();
  const cuentaTotalA = randomUUID();

  /** RIF válido de prueba (dígito verificador calculado). */
  function rifValido(ocho: string): string {
    const dv = calcularDigitoVerificadorRif('J', ocho);
    return `J-${ocho}-${dv}`;
  }

  function ctx(tenantId: string): TenantContext {
    return { tenantId, userId: undefined, ip: undefined, device: undefined };
  }
  /** Ejecuta una llamada de servicio con contexto de tenant activo (lo exige la auditoría/RLS). */
  function como<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    parties = new PartiesService(database, audit);
    items = new ItemsService(database, audit);
    itemPrices = new ItemPricesService(database, audit);
    paymentMethods = new PaymentMethodsService(database, audit);
    series = new SeriesService(database, audit);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into companies (id, tenant_id, rif, razon_social) values
      (${companyA}, ${tenantA}, 'J-00000001-7', 'Empresa A'),
      (${companyB}, ${tenantB}, 'J-00000002-5', 'Empresa B')`;
    await tdb.ownerSql`insert into branches (id, tenant_id, company_id, nombre, codigo) values
      (${branchA}, ${tenantA}, ${companyA}, 'Casa Matriz', 'M')`;
    await tdb.ownerSql`insert into accounts
      (id, tenant_id, company_id, codigo, nombre, naturaleza, nivel, es_movimiento) values
      (${cuentaMovimientoA}, ${tenantA}, ${companyA}, '1.1.01.001', 'Caja Bs', 'ACTIVO', 4, true),
      (${cuentaTotalA}, ${tenantA}, ${companyA}, '1.1.01', 'Efectivo', 'ACTIVO', 3, false)`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('parties — RIF (caso 16) y multi-tenant', () => {
    it('rechaza un RIF con dígito verificador inválido con motivo explicado', async () => {
      await expect(
        como(tenantA, () =>
          parties.crear({
            companyId: companyA,
            tipo: 'cliente',
            rif: 'J-12345678-0', // DV casi seguro incorrecto
            razonSocial: 'Cliente con RIF malo',
          }),
        ),
      ).rejects.toMatchObject({ response: { motivo: 'digito_verificador' } });
    });

    it('acepta un RIF válido y lo normaliza', async () => {
      const p = await como(tenantA, () =>
        parties.crear({
          companyId: companyA,
          tipo: 'ambos',
          rif: rifValido('30684322').replace(/-/g, ''), // sin guiones → debe normalizar
          razonSocial: 'Cliente OK',
        }),
      );
      expect(p.rif).toBe(rifValido('30684322'));
      expect(p.activo).toBe(true);
    });

    it('forzarRif permite el alta con RIF inválido y la auditoría lo marca (caso 16)', async () => {
      const p = await como(tenantA, () =>
        parties.crear({
          companyId: companyA,
          tipo: 'proveedor',
          rif: 'J-99999999-9',
          razonSocial: 'Forzado',
          forzarRif: true,
        }),
      );
      const [ev] = await tdb.ownerSql<{ accion: string }[]>`
        select accion from audit_events where entidad_id = ${p.id} and accion like 'party.crear%'`;
      expect(ev?.accion).toBe('party.crear.rif_forzado');
    });

    it('agente de retención de IVA exige % 75 o 100', async () => {
      await expect(
        como(tenantA, () =>
          parties.crear({
            companyId: companyA,
            tipo: 'cliente',
            rif: rifValido('11111111'),
            razonSocial: 'SPE sin pct',
            esAgenteRetencionIva: true,
          }),
        ),
      ).rejects.toThrow(/pctRetencionIva/);
    });

    it('el tenant B no ve los terceros del tenant A (RLS, caso 55)', async () => {
      const listaB = await como(tenantB, () => parties.listar(companyA));
      expect(listaB).toHaveLength(0);
    });

    it('rechaza crear un tercero en una empresa de otro tenant (404)', async () => {
      await expect(
        como(tenantB, () =>
          parties.crear({
            companyId: companyA, // empresa del tenant A
            tipo: 'cliente',
            rif: rifValido('22222222'),
            razonSocial: 'Intruso',
          }),
        ),
      ).rejects.toThrow(/no encontrada/i);
    });
  });

  describe('items + item_prices', () => {
    it('fija (upsert) el precio de un ítem en una lista', async () => {
      const item = await como(tenantA, () =>
        items.crear({ companyId: companyA, sku: 'SKU-1', descripcion: 'Producto 1', tipo: 'producto' }),
      );
      const [lista] = await tdb.ownerSql<{ id: string }[]>`
        insert into price_lists (tenant_id, company_id, codigo, nombre, moneda)
        values (${tenantA}, ${companyA}, 'GEN', 'General', 'USD') returning id`;
      const listaId = lista?.id as string;

      const p1 = await como(tenantA, () =>
        itemPrices.fijar({ priceListId: listaId, itemId: item.id, precio: '10.50' }),
      );
      expect(p1.precio).toBe('10.50000000');
      // Upsert: fijar de nuevo actualiza, no duplica.
      const p2 = await como(tenantA, () =>
        itemPrices.fijar({ priceListId: listaId, itemId: item.id, precio: '12' }),
      );
      expect(p2.id).toBe(p1.id);
      expect(p2.precio).toBe('12.00000000');
      const lst = await como(tenantA, () => itemPrices.listarDeLista(listaId));
      expect(lst).toHaveLength(1);
      expect(lst[0]?.sku).toBe('SKU-1');
    });
  });

  describe('payment_methods — integridad de la cuenta contable', () => {
    it('rechaza una cuenta totalizadora (no de movimiento)', async () => {
      await expect(
        como(tenantA, () =>
          paymentMethods.crear({
            companyId: companyA,
            codigo: 'EFECTIVO_BS',
            nombre: 'Caja',
            moneda: 'VES',
            cuentaId: cuentaTotalA,
          }),
        ),
      ).rejects.toThrow(/movimiento/i);
    });

    it('acepta una cuenta de movimiento de la misma empresa', async () => {
      const pm = await como(tenantA, () =>
        paymentMethods.crear({
          companyId: companyA,
          codigo: 'EFECTIVO_USD',
          nombre: 'Caja USD',
          moneda: 'USD',
          cuentaId: cuentaMovimientoA,
          causaIgtf: true,
        }),
      );
      expect(pm.causaIgtf).toBe(true);
      expect(pm.cuentaId).toBe(cuentaMovimientoA);
    });
  });

  describe('series — unicidad (regla 6)', () => {
    it('no permite dos series de empresa con mismo tipo/prefijo (NULLS NOT DISTINCT)', async () => {
      await como(tenantA, () =>
        series.crear({ companyId: companyA, docType: 'FACTURA', prefijo: 'A' }),
      );
      await expect(
        como(tenantA, () =>
          series.crear({ companyId: companyA, docType: 'FACTURA', prefijo: 'A' }),
        ),
      ).rejects.toThrow();
    });

    it('arranca el contador en next_number = 1 por defecto', async () => {
      const s = await como(tenantA, () =>
        series.crear({ companyId: companyA, branchId: branchA, docType: 'FACTURA', prefijo: 'B' }),
      );
      expect(s.nextNumber).toBe(1);
    });
  });
});
