import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { items } from './items';
import { tenants } from './tenants';
import { users } from './users';
import { warehouses } from './warehouses';

/**
 * `traslados` — traslados de mercancía entre almacenes con estado EN_TRÁNSITO (doc 06 M5; caso 41).
 * Company-scoped → RLS. Al **despachar** se generan los `stock_moves` de SALIDA en el almacén origen
 * y el traslado queda EN_TRANSITO: la mercancía no está disponible en NINGUNO de los dos almacenes
 * (camión Caracas→Valencia). Al **recibir** se generan los `stock_moves` de ENTRADA en el destino al
 * MISMO costo unitario despachado (el traslado es neutro en costo: un solo 1.4 Inventarios → sin
 * asiento). Un traslado RECIBIDO/ANULADO es inmutable (trigger en 0038).
 */
export const traslados = pgTable('traslados', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  origenWarehouseId: uuid('origen_warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  destinoWarehouseId: uuid('destino_warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  /** EN_TRANSITO | RECIBIDO | ANULADO (CHECK en 0038). */
  estado: text('estado').notNull().default('EN_TRANSITO'),
  fechaDespacho: timestamp('fecha_despacho', { withTimezone: true }).notNull(),
  fechaRecepcion: timestamp('fecha_recepcion', { withTimezone: true }),
  fechaFiscal: date('fecha_fiscal').notNull(),
  descripcion: text('descripcion'),
  hashIntegridad: text('hash_integridad'),
  createdBy: uuid('created_by').references(() => users.id),
  recibidoPor: uuid('recibido_por').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `traslado_lineas` — detalle del traslado: ítem y cantidad, con el costo unitario CONGELADO al
 * despachar (doble base) para mover el mismo valor al recibir. `salida_move_id`/`entrada_move_id`
 * enlazan los `stock_moves` de despacho y recepción.
 */
export const trasladoLineas = pgTable('traslado_lineas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  trasladoId: uuid('traslado_id')
    .notNull()
    .references(() => traslados.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  cantidad: numeric('cantidad', { precision: 20, scale: 4 }).notNull(),
  /** Costo unitario congelado al despachar (promedio vigente en el origen), doble base. */
  costoUnitVes: numeric('costo_unit_ves', { precision: 20, scale: 8 }).notNull(),
  costoUnitUsd: numeric('costo_unit_usd', { precision: 20, scale: 8 }).notNull(),
  salidaMoveId: uuid('salida_move_id'),
  entradaMoveId: uuid('entrada_move_id'),
});
