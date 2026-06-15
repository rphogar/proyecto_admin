import { boolean, date, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `nomina_trabajadores` — ficha del trabajador (P15, docs/04 §5). Tenant-scoped → RLS. Soporta
 * salario mixto (componente VES + componente en divisa con su moneda), overrides de la empresa
 * (días de utilidades/bono/vacaciones, riesgo IVSS) y el % AR-I de retención de ISLR.
 *
 * Regla 14: la cédula/RIF y el salario son datos sensibles (cifrado at-rest a nivel de
 * infraestructura). El acceso de lectura se restringe con el permiso `salary.read`.
 */
export const nominaTrabajadores = pgTable(
  'nomina_trabajadores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Cédula o RIF del trabajador (dato sensible, regla 14). */
    cedula: text('cedula').notNull(),
    nombre: text('nombre').notNull(),
    cargo: text('cargo'),
    fechaIngreso: date('fecha_ingreso').notNull(),
    fechaEgreso: date('fecha_egreso'),
    /** SEMANAL | QUINCENAL | MENSUAL (CHECK en 0046). */
    frecuenciaPago: text('frecuencia_pago').notNull().default('QUINCENAL'),
    /** Componente del salario normal mensual en VES. */
    salarioNormalMensual: numeric('salario_normal_mensual', { precision: 20, scale: 8 }).notNull(),
    /** Moneda del componente en divisa (p.ej. USD), si el salario es mixto. */
    salarioMonedaExtra: text('salario_moneda_extra'),
    /** Monto del componente en divisa (salario mixto, caso 48). */
    salarioMontoExtra: numeric('salario_monto_extra', { precision: 20, scale: 8 }),
    /** Overrides de la empresa (NULL = hereda de `companies`). */
    diasUtilidades: integer('dias_utilidades'),
    diasBonoVacacional: integer('dias_bono_vacacional'),
    diasVacaciones: integer('dias_vacaciones'),
    riesgoIvss: text('riesgo_ivss'),
    /** % de retención de ISLR vigente del AR-I (docs/04 §4). */
    ariPorcentaje: numeric('ari_porcentaje', { precision: 20, scale: 8 }).notNull().default('0'),
    cuentaPago: text('cuenta_pago'),
    dependientes: integer('dependientes').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_trabajadores_company_cedula_uq').on(t.companyId, t.cedula)],
);
