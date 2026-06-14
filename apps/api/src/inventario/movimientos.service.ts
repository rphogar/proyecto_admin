import { Injectable } from '@nestjs/common';
import { Asiento, postear } from '@contave/ledger';
import { fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { stockMoves } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalBoolean,
  optionalString,
  requireDecimal,
  requireEnum,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { armarAsientoCostoVenta, armarAsientoEntrada } from './asientos-inventario';
import {
  cargarAlmacen,
  cargarCuentas,
  cargarItem,
  exigirProducto,
  requerirPeriodoAbierto,
} from './inventario-comun';
import {
  costoItem,
  type CostoItem,
  existenciaAlmacen,
  insertarMovimiento,
  type NuevoMovimiento,
  type StockMove,
  snapshotMovimiento,
} from './kardex-core';

const TIPOS_ENTRADA = ['COMPRA', 'APERTURA', 'DEVOLUCION'] as const;

interface EntradaInput {
  companyId: string;
  warehouseId: string;
  itemId: string;
  tipo: (typeof TIPOS_ENTRADA)[number];
  cantidad: string;
  costoMoneda: 'VES' | 'USD';
  costoUnit: string;
  rateBcv: string;
  cuentaContrapartida: string;
  fecha: Date;
}

interface VentaInput {
  companyId: string;
  warehouseId: string;
  itemId: string;
  cantidad: string;
  fecha: Date;
  permitirNegativo: boolean;
}

/**
 * Movimientos de inventario que tocan el ledger (P12, docs/03 §4.3/§5 inventario permanente):
 *  - **Entrada** (compra/apertura/devolución de cliente): kardex ENTRADA + asiento D 1.4 Inventarios /
 *    C contrapartida; recalcula el costo promedio en doble base (caso 37).
 *  - **Venta**: kardex SALIDA al promedio vigente + asiento de costo de venta D 5.1 / C 1.4 (caso 38:
 *    bloqueada con stock 0 salvo `permitirNegativo`, donde usa el último promedio).
 * Más las consultas de kardex y existencias por almacén. Todo transaccional bajo RLS; el `stock_move`
 * es append-only.
 */
@Injectable()
export class MovimientosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Registra una ENTRADA de inventario con su asiento. Recalcula el costo promedio del ítem. */
  async entrada(body: unknown): Promise<StockMove> {
    const e = parseEntrada(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const item = await cargarItem(tx, e.companyId, e.itemId);
      exigirProducto(item);
      await cargarAlmacen(tx, e.companyId, e.warehouseId);
      const { porCodigo } = await cargarCuentas(tx, e.companyId);
      if (!porCodigo.has(e.cuentaContrapartida)) {
        throw new Error(
          `La cuenta de contrapartida "${e.cuentaContrapartida}" no existe en el plan`,
        );
      }

      const fFiscal = fechaFiscal(e.fecha);
      const { anio, mes } = periodoFiscal(e.fecha);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);

      const mov: NuevoMovimiento = {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        itemId: e.itemId,
        warehouseId: e.warehouseId,
        tipo: e.tipo,
        direccion: 'ENTRADA',
        cantidad: e.cantidad,
        costo: { moneda: e.costoMoneda, costoUnit: e.costoUnit, rateBcv: e.rateBcv },
        rateBcv: e.rateBcv,
        sourceType: e.tipo,
        fecha: e.fecha,
        fechaFiscal: fFiscal,
        createdBy: ctx.userId ?? null,
      };
      const fila = await snapshotMovimiento(tx, mov);

      const entrada = armarAsientoEntrada({
        fecha: e.fecha,
        descripcion: `${e.tipo} inventario ${item.sku} (${e.cantidad})`,
        costo: { ves: fila.valorVes, usd: fila.valorUsd },
        cuentaContrapartida: e.cuentaContrapartida,
        companyId: e.companyId,
      });
      let entryId: string | null = null;
      if (entrada !== undefined) {
        const asiento = postear(Asiento.construir(entrada));
        entryId = await persistirAsiento(tx, asiento, {
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          periodId,
          createdBy: ctx.userId ?? null,
          cuentas: porCodigo,
        });
      }

      const row = await insertarMovimiento(tx, mov, fila, entryId);
      await this.audit.registrar(tx, {
        accion: 'inventario.entrada',
        entidad: 'stock_moves',
        entidadId: row.id,
        after: row,
      });
      return row;
    });
  }

  /** Registra una VENTA (salida de inventario) con su asiento de costo de venta. */
  async venta(body: unknown): Promise<StockMove> {
    const e = parseVenta(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const item = await cargarItem(tx, e.companyId, e.itemId);
      exigirProducto(item);
      await cargarAlmacen(tx, e.companyId, e.warehouseId);
      const { porCodigo } = await cargarCuentas(tx, e.companyId);

      const fFiscal = fechaFiscal(e.fecha);
      const { anio, mes } = periodoFiscal(e.fecha);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);

      const mov: NuevoMovimiento = {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        itemId: e.itemId,
        warehouseId: e.warehouseId,
        tipo: 'VENTA',
        direccion: 'SALIDA',
        cantidad: e.cantidad,
        sourceType: 'VENTA',
        fecha: e.fecha,
        fechaFiscal: fFiscal,
        createdBy: ctx.userId ?? null,
        permitirNegativo: e.permitirNegativo,
      };
      // snapshotMovimiento valida el stock disponible (StockInsuficienteError → caso 38 bloqueado).
      const fila = await snapshotMovimiento(tx, mov);

      const costoVenta = armarAsientoCostoVenta({
        fecha: e.fecha,
        descripcion: `Costo de venta ${item.sku} (${e.cantidad})`,
        costo: { ves: fila.valorVes, usd: fila.valorUsd },
        companyId: e.companyId,
      });
      let entryId: string | null = null;
      if (costoVenta !== undefined) {
        const asiento = postear(Asiento.construir(costoVenta));
        entryId = await persistirAsiento(tx, asiento, {
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          periodId,
          createdBy: ctx.userId ?? null,
          cuentas: porCodigo,
        });
      }

      const row = await insertarMovimiento(tx, mov, fila, entryId);
      await this.audit.registrar(tx, {
        accion: 'inventario.venta',
        entidad: 'stock_moves',
        entidadId: row.id,
        after: row,
      });
      return row;
    });
  }

  /** Kardex de un ítem (toda la empresa) en orden cronológico, con su costo promedio vigente. */
  async kardex(
    companyId: string,
    itemId: string,
  ): Promise<{ movimientos: StockMove[]; costo: CostoItem }> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      await cargarItem(tx, companyId, itemId);
      const movimientos = await tx
        .select()
        .from(stockMoves)
        .where(and(eq(stockMoves.companyId, companyId), eq(stockMoves.itemId, itemId)))
        .orderBy(asc(stockMoves.fecha), asc(stockMoves.createdAt), asc(stockMoves.id));
      const costo = await costoItem(tx, companyId, itemId);
      return { movimientos, costo };
    });
  }

  /** Existencia física de un ítem en un almacén (Σ cantidad firmada) valorada al costo promedio. */
  async existencia(
    companyId: string,
    itemId: string,
    warehouseId: string,
  ): Promise<{ cantidad: string; valorVes: string; valorUsd: string }> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const cantidad = await existenciaAlmacen(tx, companyId, itemId, warehouseId);
      const costo = await costoItem(tx, companyId, itemId);
      return {
        cantidad: cantidad.toFixed(),
        valorVes: cantidad.times(costo.costoPromedioVes).toFixed(8),
        valorUsd: cantidad.times(costo.costoPromedioUsd).toFixed(8),
      };
    });
  }
}

function parseEntrada(body: unknown): EntradaInput {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    warehouseId: requireUuid(b.warehouseId, 'warehouseId'),
    itemId: requireUuid(b.itemId, 'itemId'),
    tipo: optEnum(b.tipo, 'tipo', TIPOS_ENTRADA, 'COMPRA'),
    cantidad: requireDecimal(b.cantidad, 'cantidad'),
    costoMoneda: requireEnum(b.costoMoneda ?? 'USD', 'costoMoneda', ['VES', 'USD'] as const, (s) =>
      s.toUpperCase(),
    ),
    costoUnit: requireDecimal(b.costoUnit, 'costoUnit', true),
    rateBcv: requireDecimal(b.rateBcv, 'rateBcv'),
    cuentaContrapartida: optionalString(b.cuentaContrapartida, 'cuentaContrapartida', 20) ?? '2.1',
    fecha: parseFecha(b.fecha ?? b.fechaDocumento),
  };
}

function parseVenta(body: unknown): VentaInput {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    warehouseId: requireUuid(b.warehouseId, 'warehouseId'),
    itemId: requireUuid(b.itemId, 'itemId'),
    cantidad: requireDecimal(b.cantidad, 'cantidad'),
    fecha: parseFecha(b.fecha),
    permitirNegativo: optionalBoolean(b.permitirNegativo, false),
  };
}

function optEnum<T extends string>(
  valor: unknown,
  campo: string,
  permitidos: readonly T[],
  def: T,
): T {
  if (valor === undefined || valor === null || String(valor).trim() === '') return def;
  return requireEnum(valor, campo, permitidos, (s) => s.toUpperCase());
}

function parseFecha(raw: unknown): Date {
  if (raw == null || String(raw).trim() === '') return new Date();
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new Error(`fecha inválida: ${String(raw)}`);
  return d;
}
