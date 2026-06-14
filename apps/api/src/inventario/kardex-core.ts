import { randomUUID } from 'node:crypto';
import { calcularKardex, type FilaKardex, type MovimientoKardex } from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { stockMoves } from '../db/schema';

/**
 * Núcleo del kardex a nivel de transacción (funciones, no servicio). Centraliza la reconstrucción del
 * costo promedio ponderado por ÍTEM (a nivel de empresa) con `@contave/fiscal-engine` y la inserción
 * append-only de un `stock_move` con su snapshot. Lo usan todos los servicios de inventario (compras,
 * ventas, ajustes, traslados, conteos) dentro de su `withTenant`.
 *
 * El costo promedio es por ítem (art. 177 Ley ISLR); las existencias por almacén se derivan sumando la
 * cantidad firmada por `warehouse_id` ({@link existenciaAlmacen}). Para que el snapshot sea determinista
 * bajo concurrencia (invariante 4, caso 53), {@link persistirMovimiento} serializa por ítem con un
 * advisory lock de transacción.
 */

export type TipoMovimiento =
  | 'COMPRA'
  | 'VENTA'
  | 'AJUSTE'
  | 'TRASLADO'
  | 'DEVOLUCION'
  | 'APERTURA'
  | 'CONTEO';
export type Direccion = 'ENTRADA' | 'SALIDA';

/** Costo de una ENTRADA: forma A (un lado + tasa) o B (ambas bases ya valoradas). */
export type CostoMovimiento =
  | { moneda: 'VES' | 'USD'; costoUnit: string; rateBcv: string }
  | { costoUnitVes: string; costoUnitUsd: string };

export interface NuevoMovimiento {
  readonly tenantId: string;
  readonly companyId: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly tipo: TipoMovimiento;
  readonly direccion: Direccion;
  readonly cantidad: string;
  /** Costo de adquisición (obligatorio si `direccion === 'ENTRADA'`). */
  readonly costo?: CostoMovimiento;
  readonly rateBcv?: string | null;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
  readonly journalEntryId?: string | null;
  readonly fecha: Date;
  readonly fechaFiscal: string;
  readonly createdBy?: string | null;
  /** Permitir saldo negativo (venta en negativo / backorder, caso 38). Default false. */
  readonly permitirNegativo?: boolean;
}

export type StockMove = typeof stockMoves.$inferSelect;

/** Movimientos del ítem (toda la empresa) en orden cronológico, como entrada del motor de kardex. */
async function movimientosDelItem(
  tx: DatabaseTx,
  companyId: string,
  itemId: string,
): Promise<MovimientoKardex[]> {
  const filas = await tx
    .select()
    .from(stockMoves)
    .where(and(eq(stockMoves.companyId, companyId), eq(stockMoves.itemId, itemId)))
    .orderBy(asc(stockMoves.fecha), asc(stockMoves.createdAt), asc(stockMoves.id));
  return filas.map((f) => mapAMovimiento(f));
}

function mapAMovimiento(f: StockMove): MovimientoKardex {
  const base: MovimientoKardex = {
    tipo: f.tipo as MovimientoKardex['tipo'],
    direccion: f.direccion as Direccion,
    cantidad: f.cantidad,
    referencia: f.id,
  };
  if (f.direccion === 'ENTRADA') {
    return { ...base, costo: { costoUnitVes: f.costoUnitVes, costoUnitUsd: f.costoUnitUsd } };
  }
  return base;
}

function candidatoAMovimiento(m: NuevoMovimiento): MovimientoKardex {
  const base: MovimientoKardex = {
    tipo: m.tipo,
    direccion: m.direccion,
    cantidad: m.cantidad,
    referencia: 'CANDIDATO',
  };
  if (m.direccion === 'ENTRADA') {
    if (m.costo === undefined) {
      throw new Error('persistirMovimiento: una ENTRADA requiere costo');
    }
    return { ...base, costo: m.costo };
  }
  return base;
}

/**
 * Calcula (sin insertar) el snapshot del candidato con el motor de kardex, reprocesando los
 * movimientos del ítem + el candidato. **Adquiere el advisory lock del ítem** (xact-level): el llamador
 * DEBE insertar el movimiento en la misma transacción para que el costo promedio sea determinista bajo
 * concurrencia (invariante 4, caso 53). Permite armar el asiento (costo de venta/ajuste) ANTES de
 * insertar el `stock_move`, ya que el kardex es append-only (no se puede actualizar el `journal_entry_id`
 * después).
 */
export async function snapshotMovimiento(tx: DatabaseTx, m: NuevoMovimiento): Promise<FilaKardex> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kardex:${m.companyId}:${m.itemId}`}, 0))`,
  );
  const previos = await movimientosDelItem(tx, m.companyId, m.itemId);
  const resultado = calcularKardex([...previos, candidatoAMovimiento(m)], {
    permitirNegativo: m.permitirNegativo ?? false,
  });
  const fila = resultado.filas[resultado.filas.length - 1];
  if (fila === undefined) {
    throw new Error('snapshotMovimiento: el motor de kardex no devolvió la fila del movimiento');
  }
  return fila;
}

/** Inserta el `stock_move` append-only con el snapshot ya calculado y el asiento (si lo hubo) enlazado. */
export async function insertarMovimiento(
  tx: DatabaseTx,
  m: NuevoMovimiento,
  fila: FilaKardex,
  journalEntryId: string | null,
): Promise<StockMove> {
  const [row] = await tx
    .insert(stockMoves)
    .values({
      id: randomUUID(),
      tenantId: m.tenantId,
      companyId: m.companyId,
      itemId: m.itemId,
      warehouseId: m.warehouseId,
      tipo: m.tipo,
      direccion: m.direccion,
      cantidad: fila.cantidad,
      costoUnitVes: fila.costoUnitVes,
      costoUnitUsd: fila.costoUnitUsd,
      valorVes: fila.valorVes,
      valorUsd: fila.valorUsd,
      rateBcv: m.rateBcv ?? null,
      saldoCantidad: fila.saldoCantidad,
      saldoValorVes: fila.saldoValorVes,
      saldoValorUsd: fila.saldoValorUsd,
      costoPromedioVes: fila.costoPromedioVes,
      costoPromedioUsd: fila.costoPromedioUsd,
      sourceType: m.sourceType ?? null,
      sourceId: m.sourceId ?? null,
      journalEntryId: journalEntryId ?? m.journalEntryId ?? null,
      fecha: m.fecha,
      fechaFiscal: m.fechaFiscal,
      createdBy: m.createdBy ?? null,
    })
    .returning();
  if (row === undefined) throw new Error('No se pudo registrar el movimiento de inventario');
  return row;
}

/**
 * Calcula el snapshot e inserta el `stock_move` en un paso (movimientos sin asiento o con asiento ya
 * conocido). Para flujos que postean el asiento DESPUÉS de conocer el costo, usar
 * {@link snapshotMovimiento} + {@link insertarMovimiento}.
 */
export async function persistirMovimiento(tx: DatabaseTx, m: NuevoMovimiento): Promise<StockMove> {
  const fila = await snapshotMovimiento(tx, m);
  return insertarMovimiento(tx, m, fila, m.journalEntryId ?? null);
}

/** Costo promedio vigente del ÍTEM (toda la empresa), tras los movimientos existentes. */
export interface CostoItem {
  readonly saldoCantidad: string;
  readonly costoPromedioVes: string;
  readonly costoPromedioUsd: string;
}

export async function costoItem(
  tx: DatabaseTx,
  companyId: string,
  itemId: string,
): Promise<CostoItem> {
  const previos = await movimientosDelItem(tx, companyId, itemId);
  if (previos.length === 0) {
    return { saldoCantidad: '0', costoPromedioVes: '0.00000000', costoPromedioUsd: '0.00000000' };
  }
  const k = calcularKardex(previos, { permitirNegativo: true });
  return {
    saldoCantidad: k.saldoCantidad,
    costoPromedioVes: k.costoPromedioVes,
    costoPromedioUsd: k.costoPromedioUsd,
  };
}

/** Existencia física de un ítem en un almacén = Σ cantidad firmada (ENTRADA +, SALIDA −) de ese almacén. */
export async function existenciaAlmacen(
  tx: DatabaseTx,
  companyId: string,
  itemId: string,
  warehouseId: string,
): Promise<Decimal> {
  const filas = await tx
    .select({ direccion: stockMoves.direccion, cantidad: stockMoves.cantidad })
    .from(stockMoves)
    .where(
      and(
        eq(stockMoves.companyId, companyId),
        eq(stockMoves.itemId, itemId),
        eq(stockMoves.warehouseId, warehouseId),
      ),
    );
  return filas.reduce(
    (acc, f) => acc.plus(new Decimal(f.cantidad).times(f.direccion === 'ENTRADA' ? 1 : -1)),
    new Decimal(0),
  );
}
