import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { items } from './items';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';
import { warehouses } from './warehouses';

/**
 * `stock_moves` — movimientos de inventario y kardex en DOBLE BASE (docs/05 §3.8, doc 06 M5;
 * casos 37–41). Company-scoped → RLS. Es un ledger **append-only**: cada fila es un asiento del
 * kardex INMUTABLE (trigger en 0038 además de la capa de aplicación); las correcciones se hacen con
 * un nuevo movimiento (ajuste/devolución), nunca con UPDATE/DELETE.
 *
 * Cada movimiento guarda el costo unitario aplicado en Bs y USD (regla 10) y un **snapshot del saldo
 * acumulado** tras aplicarlo (cantidad, valor y costo promedio en ambas bases). El costo promedio es
 * **por ítem a nivel de empresa** (art. 177 Ley ISLR valora el inventario fiscal por ítem, no por
 * almacén): los campos `saldo_*`/`costo_promedio_*` son el estado del ÍTEM tras el movimiento,
 * reconstruible con `@contave/fiscal-engine` (`calcularKardex`) ordenando los movimientos del ítem por
 * `(fecha, created_at)`. Las **existencias por almacén** se derivan aparte sumando la cantidad firmada
 * por `warehouse_id`. El snapshot se almacena para que el kardex sea trivial y trazable (invariante 4).
 * Un traslado mueve cantidad entre almacenes pero es neutro a nivel de ítem (no altera valor ni costo).
 *
 * `source_type`/`source_id` enlazan el documento origen (compra, factura, ajuste, traslado, conteo);
 * `journal_entry_id` se llena cuando el movimiento genera asiento contable (costo de venta, ajuste).
 */
export const stockMoves = pgTable('stock_moves', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  /** COMPRA | VENTA | AJUSTE | TRASLADO | DEVOLUCION | APERTURA | CONTEO (CHECK en 0038). */
  tipo: text('tipo').notNull(),
  /** ENTRADA aumenta el stock; SALIDA lo disminuye (CHECK en 0038). */
  direccion: text('direccion').notNull(),
  /** Magnitud (> 0) en la unidad del ítem. */
  cantidad: numeric('cantidad', { precision: 20, scale: 4 }).notNull(),
  /** Costo unitario aplicado al movimiento en doble base (en SALIDA = promedio vigente). */
  costoUnitVes: numeric('costo_unit_ves', { precision: 20, scale: 8 }).notNull(),
  costoUnitUsd: numeric('costo_unit_usd', { precision: 20, scale: 8 }).notNull(),
  /** Valor del movimiento (cantidad × costo unitario) en doble base. */
  valorVes: numeric('valor_ves', { precision: 20, scale: 8 }).notNull(),
  valorUsd: numeric('valor_usd', { precision: 20, scale: 8 }).notNull(),
  /** Tasa BCV congelada del movimiento (Bs/USD). */
  rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
  /** Snapshot del saldo acumulado tras el movimiento (kardex, reconstruible). */
  saldoCantidad: numeric('saldo_cantidad', { precision: 20, scale: 4 }).notNull(),
  saldoValorVes: numeric('saldo_valor_ves', { precision: 20, scale: 8 }).notNull(),
  saldoValorUsd: numeric('saldo_valor_usd', { precision: 20, scale: 8 }).notNull(),
  costoPromedioVes: numeric('costo_promedio_ves', { precision: 20, scale: 8 }).notNull(),
  costoPromedioUsd: numeric('costo_promedio_usd', { precision: 20, scale: 8 }).notNull(),
  /** Documento origen: FACTURA | COMPRA | AJUSTE | TRASLADO | CONTEO | APERTURA (informativo). */
  sourceType: text('source_type'),
  sourceId: uuid('source_id'),
  /** Asiento contable generado por el movimiento (costo de venta, ajuste); NULL si es neutro. */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  /** Instante del movimiento (UTC); la fecha fiscal (Caracas) ordena el kardex y corta períodos. */
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  fechaFiscal: date('fecha_fiscal').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
