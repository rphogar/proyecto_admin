import { integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { nominaTrabajadores } from './nomina-trabajadores';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `nomina_prestaciones_kardex` — ledger APPEND-ONLY de prestaciones sociales por trabajador (P15,
 * docs/04 §2.3, art. 142). Registra depósitos trimestrales (15 días integral), días adicionales
 * (2/año desde el 2.º), intereses capitalizados, anticipos y la liquidación final. Es la fuente de
 * la vía "garantía" del doble cálculo. No admite UPDATE ni DELETE (trigger en 0046). Tenant-scoped → RLS.
 */
export const nominaPrestacionesKardex = pgTable('nomina_prestaciones_kardex', {
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
  fecha: timestamp('fecha', { withTimezone: true }).notNull(),
  /** DEPOSITO_TRIMESTRAL | DIAS_ADICIONALES | INTERES | ADELANTO | LIQUIDACION (CHECK en 0046). */
  tipo: text('tipo').notNull(),
  diasIntegral: numeric('dias_integral', { precision: 20, scale: 4 }),
  salarioIntegralDiario: numeric('salario_integral_diario', { precision: 20, scale: 8 }),
  montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
  montoUsd: numeric('monto_usd', { precision: 20, scale: 8 }),
  /** Saldo de garantía acumulado tras el movimiento (informativo; la verdad se deriva del kardex). */
  saldoGarantiaVes: numeric('saldo_garantia_ves', { precision: 20, scale: 8 }),
  nota: text('nota'),
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * `nomina_provisiones` — provisiones mensuales de pasivos laborales por trabajador (P15, docs/04
 * §2): utilidades, vacaciones, bono vacacional, prestaciones (garantía) e intereses, 1/12 del año
 * (con la garantía del mes). Enlaza el asiento de provisión (gasto 6.1 contra 2.4.0x). La unicidad
 * `(company, anio, mes, trabajador)` da idempotencia. Tenant-scoped → RLS.
 */
export const nominaProvisiones = pgTable(
  'nomina_provisiones',
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
    trabajadorId: uuid('trabajador_id')
      .notNull()
      .references(() => nominaTrabajadores.id),
    utilidades: numeric('utilidades', { precision: 20, scale: 8 }).notNull(),
    vacaciones: numeric('vacaciones', { precision: 20, scale: 8 }).notNull(),
    bonoVacacional: numeric('bono_vacacional', { precision: 20, scale: 8 }).notNull(),
    prestaciones: numeric('prestaciones', { precision: 20, scale: 8 }).notNull(),
    intereses: numeric('intereses', { precision: 20, scale: 8 }).notNull(),
    total: numeric('total', { precision: 20, scale: 8 }).notNull(),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_provisiones_company_periodo_trab_uq').on(t.companyId, t.anio, t.mes, t.trabajadorId)],
);
