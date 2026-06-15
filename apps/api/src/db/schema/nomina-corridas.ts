import { boolean, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { nominaTrabajadores } from './nomina-trabajadores';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `nomina_corridas` — corrida de nómina de un período (P15, docs/04 §5). Flujo
 * BORRADOR → APROBADA → CONTABILIZADA (CHECK en 0046). Al aprobar se materializan los recibos
 * (inmutables); al contabilizar se postea el asiento (gasto 6.1 contra pasivos 2.4.0x) y se enlaza
 * `journal_entry_id`. La corrida CONTABILIZADA es inmutable (trigger en 0046). Tenant-scoped → RLS.
 */
export const nominaCorridas = pgTable(
  'nomina_corridas',
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
    /** Etiqueta única del período de pago (p.ej. "2026-06-Q2"). */
    periodoEtiqueta: text('periodo_etiqueta').notNull(),
    /** SEMANAL | QUINCENAL | MENSUAL. */
    frecuencia: text('frecuencia').notNull(),
    fechaInicio: timestamp('fecha_inicio', { withTimezone: true }).notNull(),
    fechaFin: timestamp('fecha_fin', { withTimezone: true }).notNull(),
    /** BORRADOR | APROBADA | CONTABILIZADA (CHECK en 0046). */
    estado: text('estado').notNull().default('BORRADOR'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    totalAsignaciones: numeric('total_asignaciones', { precision: 20, scale: 8 }).notNull().default('0'),
    totalDeducciones: numeric('total_deducciones', { precision: 20, scale: 8 }).notNull().default('0'),
    totalNeto: numeric('total_neto', { precision: 20, scale: 8 }).notNull().default('0'),
    totalAportesPatronales: numeric('total_aportes_patronales', { precision: 20, scale: 8 }).notNull().default('0'),
    aprobadaPor: uuid('aprobada_por').references(() => users.id),
    aprobadaEn: timestamp('aprobada_en', { withTimezone: true }),
    contabilizadaEn: timestamp('contabilizada_en', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_corridas_company_periodo_uq').on(t.companyId, t.periodoEtiqueta)],
);

/**
 * `nomina_recibos` — recibo de pago de un trabajador en una corrida. Doble base VES/USD. Inmutable
 * una vez la corrida sale de BORRADOR (trigger en 0046). Tenant-scoped → RLS.
 */
export const nominaRecibos = pgTable(
  'nomina_recibos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    corridaId: uuid('corrida_id')
      .notNull()
      .references(() => nominaCorridas.id, { onDelete: 'cascade' }),
    trabajadorId: uuid('trabajador_id')
      .notNull()
      .references(() => nominaTrabajadores.id),
    diasEfectivos: numeric('dias_efectivos', { precision: 20, scale: 4 }).notNull(),
    salarioDiario: numeric('salario_diario', { precision: 20, scale: 8 }).notNull(),
    salarioDiarioIntegral: numeric('salario_diario_integral', { precision: 20, scale: 8 }).notNull(),
    totalAsignaciones: numeric('total_asignaciones', { precision: 20, scale: 8 }).notNull(),
    totalDeducciones: numeric('total_deducciones', { precision: 20, scale: 8 }).notNull(),
    neto: numeric('neto', { precision: 20, scale: 8 }).notNull(),
    netoUsd: numeric('neto_usd', { precision: 20, scale: 8 }),
    rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_recibos_corrida_trabajador_uq').on(t.corridaId, t.trabajadorId)],
);

/**
 * `nomina_recibo_lineas` — detalle por concepto del recibo, con las 6 columnas multimoneda
 * (regla 10). Inmutable junto al recibo. Tenant-scoped → RLS.
 */
export const nominaReciboLineas = pgTable('nomina_recibo_lineas', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  reciboId: uuid('recibo_id')
    .notNull()
    .references(() => nominaRecibos.id, { onDelete: 'cascade' }),
  conceptoCodigo: text('concepto_codigo').notNull(),
  nombre: text('nombre').notNull(),
  /** ASIGNACION | DEDUCCION. */
  tipo: text('tipo').notNull(),
  salarial: boolean('salarial').notNull().default(false),
  moneda: text('moneda').notNull().default('VES'),
  montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
  montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
  montoUsdMgmt: numeric('monto_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
  rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
  rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
  orden: integer('orden').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
