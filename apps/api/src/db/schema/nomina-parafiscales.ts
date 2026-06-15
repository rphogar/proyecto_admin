import { date, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { nominaTrabajadores } from './nomina-trabajadores';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `nomina_parafiscales` — liquidación de parafiscales por período y régimen (P15, docs/04 §3):
 * IVSS, RPE, FAOV, INCES. Guarda base y montos trabajador/patrono en VES, las semanas cotizables
 * (lunes) y el estado de la planilla (TIUNA/BANAVIH/INCES). La planilla PRESENTADA es inmutable
 * (trigger en 0046). Tenant-scoped → RLS.
 */
export const nominaParafiscales = pgTable(
  'nomina_parafiscales',
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
    /** IVSS | RPE | FAOV | INCES (CHECK en 0046). */
    regimen: text('regimen').notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    montoTrabajadorVes: numeric('monto_trabajador_ves', { precision: 20, scale: 8 }).notNull(),
    montoPatronoVes: numeric('monto_patrono_ves', { precision: 20, scale: 8 }).notNull(),
    semanasCotizables: integer('semanas_cotizables'),
    /** BORRADOR | GENERADA | PRESENTADA (CHECK en 0046). */
    estadoPlanilla: text('estado_planilla').notNull().default('BORRADOR'),
    archivoRef: text('archivo_ref'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_parafiscales_company_periodo_regimen_uq').on(t.companyId, t.anio, t.mes, t.regimen)],
);

/**
 * `nomina_ari` — porcentaje de retención de ISLR del AR-I por trabajador y ejercicio (P15, docs/04
 * §4). Histórico de ajustes (enero, y marzo/junio/sept/dic) mediante `vigente_desde`. `origen`
 * distingue el % estimado por el trabajador del determinado por el patrono. Tenant-scoped → RLS.
 */
export const nominaAri = pgTable(
  'nomina_ari',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    trabajadorId: uuid('trabajador_id')
      .notNull()
      .references(() => nominaTrabajadores.id),
    ejercicio: integer('ejercicio').notNull(),
    porcentaje: numeric('porcentaje', { precision: 20, scale: 8 }).notNull(),
    vigenteDesde: date('vigente_desde').notNull(),
    /** TRABAJADOR | PATRONO (CHECK en 0046). */
    origen: text('origen').notNull().default('TRABAJADOR'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_ari_company_trab_ejercicio_desde_uq').on(t.companyId, t.trabajadorId, t.ejercicio, t.vigenteDesde)],
);

/**
 * `nomina_arc` — certificado anual de remuneraciones y retenciones (ARC) por trabajador y ejercicio
 * (P15, docs/04 §4). Inmutable una vez emitido (`emitido_en` no nulo; trigger en 0046).
 * Tenant-scoped → RLS.
 */
export const nominaArc = pgTable(
  'nomina_arc',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    trabajadorId: uuid('trabajador_id')
      .notNull()
      .references(() => nominaTrabajadores.id),
    ejercicio: integer('ejercicio').notNull(),
    totalRemuneracionVes: numeric('total_remuneracion_ves', { precision: 20, scale: 8 }).notNull(),
    totalRetenidoVes: numeric('total_retenido_ves', { precision: 20, scale: 8 }).notNull(),
    emitidoEn: timestamp('emitido_en', { withTimezone: true }),
    archivoRef: text('archivo_ref'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_arc_company_trab_ejercicio_uq').on(t.companyId, t.trabajadorId, t.ejercicio)],
);
