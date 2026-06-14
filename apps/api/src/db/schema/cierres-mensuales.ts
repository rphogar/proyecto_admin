import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { periods } from './periods';
import { revaluaciones } from './revaluaciones';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `cierres_mensuales` — corrida del wizard de cierre mensual (P13, docs/06 M6, casos 11/42/43).
 * Tenant-scoped → RLS. El cierre ejecuta el checklist de 8 pasos (tasas, borradores, conciliación,
 * diferencial NO realizado, depreciación, provisiones, prorrata IVA, balance cuadrado), postea los
 * asientos automáticos idempotentes y bloquea el período (`periods.estado='CLOSED'`).
 *
 * La unicidad `(company, anio, mes)` da **idempotencia** (caso 11): re-cerrar es no-op. Un cierre
 * CERRADO es inmutable salvo la **reapertura auditada** (CERRADO→REABIERTO con `reopen_reason` +
 * `reopened_by`), que solo owner+contador puede hacer (caso 43); el trigger de 0042 lo impone.
 */
export const cierresMensuales = pgTable(
  'cierres_mensuales',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    anio: integer('anio').notNull(),
    mes: integer('mes').notNull(),
    periodId: uuid('period_id')
      .notNull()
      .references(() => periods.id),
    /** EN_PROCESO | CERRADO | REABIERTO (CHECK en 0042). */
    estado: text('estado').notNull().default('EN_PROCESO'),
    /** Snapshot del checklist (8 pasos con estado/bloqueante/detalle) al momento del cierre. */
    checklist: jsonb('checklist').notNull(),
    /** Corrida de revaluación (diferencial no realizado, paso 4) generada por el cierre. */
    revaluacionId: uuid('revaluacion_id').references(() => revaluaciones.id),
    /** Resultado del paso 8 (balance de comprobación cuadrado en ambas bases). */
    balanceCuadra: boolean('balance_cuadra'),
    closedBy: uuid('closed_by').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedBy: uuid('reopened_by').references(() => users.id),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    /** Motivo OBLIGATORIO de reapertura (caso 43). */
    reopenReason: text('reopen_reason'),
    /** sha256 del payload de cierre (cadena de integridad, Providencia 121). */
    hash: text('hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('cierres_mensuales_company_periodo_uq').on(t.companyId, t.anio, t.mes)],
);
