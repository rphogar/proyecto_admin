import { boolean, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `accounts` — plan de cuentas por empresa (docs/05 §3.2, docs/03 §2). Tenant-scoped → RLS.
 *
 * El árbol y la naturaleza se modelan en `@contave/ledger` (PlanDeCuentas); esta tabla persiste
 * el catálogo materializado de cada empresa (sembrado desde `PLAN_DE_CUENTAS_BASE`). La columna
 * `naturaleza`, `nivel`, `codigo_padre` y `es_movimiento` se derivan del código al sembrar.
 * Las cuentas totalizadoras (`es_movimiento = false`) NO reciben líneas: lo hace cumplir el
 * trigger de cuadre/imputación y la capa de aplicación.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Código jerárquico `C.GG.SS.AAA`. */
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** ACTIVO | PASIVO | PATRIMONIO | INGRESO | COSTO | GASTO (derivada de la clase). */
    naturaleza: text('naturaleza').notNull(),
    /** Profundidad del código (1 = clase raíz). */
    nivel: integer('nivel').notNull(),
    /** Código del padre directo; NULL en las clases raíz. */
    codigoPadre: text('codigo_padre'),
    /** Cuenta de movimiento (hoja): puede recibir líneas de asiento. */
    esMovimiento: boolean('es_movimiento').notNull(),
    /** Moneda funcional cuando es una cuenta en divisa (informativa). */
    moneda: text('moneda'),
    /** Cuenta de sistema del catálogo base: no borrable si tiene movimientos. */
    esSistema: boolean('es_sistema').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('accounts_company_codigo_uq').on(t.companyId, t.codigo)],
);
