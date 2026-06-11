import { date, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * `fiscal_params` — valores normativos variables con vigencia (regla 17 de CLAUDE.md):
 * UT, alícuotas, salario mínimo, cestaticket, tasas de retención, calendario SPE, feriados.
 * NUNCA hardcodeados. Tenant-scoped → RLS (decisión P2: cada tenant tiene su juego de
 * parámetros; los valores nacionales se siembran por tenant al crearlo).
 *
 * `valor` es jsonb para admitir escalares y estructuras (p.ej. tramos por alícuota).
 * La unicidad temporal por `(tenant_id, clave)` se garantiza con una EXCLUDE constraint
 * (btree_gist sobre `daterange(vigente_desde, vigente_hasta, '[)')`) en la migración
 * `0002b_fiscal_params_vigencias` — Drizzle no la expresa, va en SQL custom. `vigente_hasta`
 * NULL = vigencia abierta.
 */
export const fiscalParams = pgTable(
  'fiscal_params',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clave: text('clave').notNull(),
    valor: jsonb('valor').notNull(),
    vigenteDesde: date('vigente_desde').notNull(),
    vigenteHasta: date('vigente_hasta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('fiscal_params_tenant_clave_idx').on(t.tenantId, t.clave)],
);
