import { boolean, date, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `nomina_conceptos` — catálogo de conceptos (asignaciones/deducciones) con FÓRMULA segura (P15,
 * docs/04 §5). La fórmula es un texto del DSL puro (`@contave/fiscal-engine`: `evaluarFormula`) que
 * se valida con `validarFormula` antes de guardar (sin `eval`). `salarial` indica si el concepto
 * integra el salario (base de prestaciones/retenciones). La vigencia (`vigente_desde/hasta`) permite
 * versionar el catálogo sin reescribir lo ya contabilizado. Tenant-scoped → RLS.
 */
export const nominaConceptos = pgTable(
  'nomina_conceptos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** ASIGNACION | DEDUCCION (CHECK en 0046). */
    tipo: text('tipo').notNull(),
    /** Fórmula del DSL seguro (p.ej. "salario_diario * dias"). */
    formula: text('formula').notNull(),
    salarial: boolean('salarial').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    vigenteDesde: date('vigente_desde'),
    vigenteHasta: date('vigente_hasta'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('nomina_conceptos_company_codigo_uq').on(t.companyId, t.codigo)],
);
