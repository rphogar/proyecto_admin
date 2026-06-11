import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `series` — series de documentos con contador transaccional (docs/05 §3.4 y §4, regla 6).
 * Company-scoped → RLS.
 *
 * `next_number` es el PRÓXIMO número a asignar; la emisión hace
 * `UPDATE series SET next_number = next_number + 1 ... RETURNING` DENTRO de la misma transacción
 * del documento (§4): el `UPDATE` bloquea la fila (FOR UPDATE implícito) y, si la transacción
 * falla, el número NO se consume → numeración estrictamente consecutiva y SIN huecos (regla 6,
 * casos 21/24/53). **Prohibido `SERIAL`/secuencias nativas** (dejan huecos en rollback).
 *
 * Una serie es por `(company, branch?, doc_type, prefijo)`. `branch_id` NULL = serie de la
 * empresa (no atada a sucursal). La unicidad cae en la migración de constraints porque involucra
 * un `COALESCE` sobre el `branch_id` nullable (Drizzle no expresa índices con expresiones).
 */
export const series = pgTable('series', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Sucursal de la serie; NULL = serie a nivel de empresa. */
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
  /**
   * Tipo de documento (docs/05 §3.4): FACTURA | NOTA_CREDITO | NOTA_DEBITO | GUIA_DESPACHO |
   * PEDIDO | PRESUPUESTO | COMPRA | NOTA_ENTREGA | COMPROBANTE_RETENCION_IVA |
   * COMPROBANTE_RETENCION_ISLR (CHECK).
   */
  docType: text('doc_type').notNull(),
  /** Prefijo de la serie (p.ej. 'A', 'FAC-', ''); discrimina series del mismo tipo. */
  prefijo: text('prefijo').notNull().default(''),
  /** Próximo número a asignar (contador transaccional, §4). Arranca en 1. */
  nextNumber: integer('next_number').notNull().default(1),
  activo: boolean('activo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
