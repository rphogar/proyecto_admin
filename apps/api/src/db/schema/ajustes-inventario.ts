import { boolean, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { items } from './items';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';
import { warehouses } from './warehouses';

/**
 * `ajustes_inventario` — ajustes de existencias con MOTIVO y APROBACIÓN (doc 06 M5; caso 40).
 * Company-scoped → RLS. Separación de deberes (regla 13): quien crea el ajuste (`created_by`) no es
 * quien lo aprueba (`aprobado_por`). El ajuste nace PENDIENTE; al APROBARSE se generan los
 * `stock_moves` y el asiento contable (inventario contra gasto/ingreso). Un ajuste APROBADO es
 * **inmutable** (trigger en 0038); para revertirlo se hace un ajuste inverso.
 *
 * `deducible` marca si la merma es gasto deducible o no (caso 40: flag para la conciliación fiscal
 * ISLR — sin soporte adecuado va a 6.8 Gastos no deducibles). `conteo_id` enlaza el ajuste que nace
 * del cierre de un conteo físico.
 */
export const ajustesInventario = pgTable('ajustes_inventario', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  /** MERMA | ROBO | SOBRANTE | CONTEO | OTRO (CHECK en 0038). */
  tipo: text('tipo').notNull(),
  /** Motivo obligatorio del ajuste (auditoría, caso 40). */
  motivo: text('motivo').notNull(),
  /** Gasto deducible (true) vs no deducible (false → cuenta 6.8). Flag de conciliación fiscal. */
  deducible: boolean('deducible').notNull().default(false),
  /** PENDIENTE | APROBADO | RECHAZADO (CHECK en 0038). */
  estado: text('estado').notNull().default('PENDIENTE'),
  /** Conteo físico del que nace el ajuste (NULL si es una merma/robo directo). */
  conteoId: uuid('conteo_id'),
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  fechaFiscal: date('fecha_fiscal').notNull(),
  /** Asiento generado al aprobar (inventario ⇄ gasto/ingreso). */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  totalValorVes: numeric('total_valor_ves', { precision: 20, scale: 8 }),
  totalValorUsd: numeric('total_valor_usd', { precision: 20, scale: 8 }),
  hashIntegridad: text('hash_integridad'),
  createdBy: uuid('created_by').references(() => users.id),
  aprobadoPor: uuid('aprobado_por').references(() => users.id),
  aprobadoAt: timestamp('aprobado_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `ajuste_lineas` — detalle de un ajuste de inventario: ítem, almacén, dirección y cantidad. Los
 * costos (`costo_unit_*`, `valor_*`) y el `stock_move_id` se llenan AL APROBAR, valorando la salida al
 * promedio vigente (merma) o la entrada al costo indicado/promedio (sobrante).
 */
export const ajusteLineas = pgTable('ajuste_lineas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  ajusteId: uuid('ajuste_id')
    .notNull()
    .references(() => ajustesInventario.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  /** ENTRADA (sobrante) | SALIDA (merma/robo) (CHECK en 0038). */
  direccion: text('direccion').notNull(),
  cantidad: numeric('cantidad', { precision: 20, scale: 4 }).notNull(),
  /** Costo unitario en doble base resuelto al aprobar (NULL mientras está PENDIENTE). */
  costoUnitVes: numeric('costo_unit_ves', { precision: 20, scale: 8 }),
  costoUnitUsd: numeric('costo_unit_usd', { precision: 20, scale: 8 }),
  valorVes: numeric('valor_ves', { precision: 20, scale: 8 }),
  valorUsd: numeric('valor_usd', { precision: 20, scale: 8 }),
  /** Movimiento de kardex generado al aprobar. */
  stockMoveId: uuid('stock_move_id'),
});
