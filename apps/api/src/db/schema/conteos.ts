import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { items } from './items';
import { tenants } from './tenants';
import { users } from './users';
import { warehouses } from './warehouses';

/**
 * `conteos_fisicos` — planilla de conteo físico de un almacén (doc 06 M5). Company-scoped → RLS.
 * Se abre con las cantidades del sistema congeladas por ítem; el operador captura lo contado (lector)
 * y al CERRARSE las diferencias generan un `ajustes_inventario` (tipo CONTEO) que pasa por aprobación
 * (caso 40). Un conteo CERRADO es inmutable (trigger en 0038).
 */
export const conteosFisicos = pgTable('conteos_fisicos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id, { onDelete: 'restrict' }),
  /** ABIERTO | CERRADO (CHECK en 0038). */
  estado: text('estado').notNull().default('ABIERTO'),
  descripcion: text('descripcion'),
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  fechaFiscal: date('fecha_fiscal').notNull(),
  /** Ajuste generado al cerrar (NULL si no hubo diferencias). */
  ajusteId: uuid('ajuste_id'),
  createdBy: uuid('created_by').references(() => users.id),
  cerradoPor: uuid('cerrado_por').references(() => users.id),
  cerradoAt: timestamp('cerrado_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `conteo_lineas` — renglón de la planilla: ítem, cantidad del sistema (congelada al abrir) y
 * cantidad contada; la diferencia (`contada − sistema`) alimenta el ajuste al cerrar.
 */
export const conteoLineas = pgTable('conteo_lineas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  conteoId: uuid('conteo_id')
    .notNull()
    .references(() => conteosFisicos.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'restrict' }),
  cantidadSistema: numeric('cantidad_sistema', { precision: 20, scale: 4 }).notNull(),
  cantidadContada: numeric('cantidad_contada', { precision: 20, scale: 4 }),
  diferencia: numeric('diferencia', { precision: 20, scale: 4 }),
});
