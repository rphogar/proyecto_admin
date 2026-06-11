import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * `companies` — empresas (RIF) de un tenant. Un tenant puede tener varias (docs/05 §2).
 * Tenant-scoped → RLS. El `rif` se valida en capa de aplicación con `validarRif`
 * (`@contave/shared`) antes de insertar; aquí solo se garantiza unicidad por tenant.
 *
 * Campos del perfil del contribuyente (docs/05 §3.1). El perfil es versionable por vigencia
 * en fases posteriores (caso 44: empresa que se vuelve SPE a mitad de año); P2 fija el estado
 * actual.
 */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    rif: text('rif').notNull(),
    razonSocial: text('razon_social').notNull(),
    /** ORDINARIO | ESPECIAL | FORMAL — clasificación SENIAT del contribuyente. */
    tipoContribuyente: text('tipo_contribuyente').notNull().default('ORDINARIO'),
    /** Sujeto Pasivo Especial: si es agente de retención designado por el SENIAT. */
    spe: boolean('spe').notNull().default(false),
    /** % de IVA que le retienen sus clientes SPE (75 o 100). */
    pctRetencionQueLeAplican: numeric('pct_retencion_que_le_aplican', {
      precision: 5,
      scale: 2,
    }),
    /** Mes de inicio del ejercicio fiscal (1–12); por defecto enero. */
    ejercicioFiscalInicio: integer('ejercicio_fiscal_inicio').notNull().default(1),
    /** Clase de riesgo ocupacional IVSS: minimo | medio | maximo. */
    riesgoIvss: text('riesgo_ivss'),
    /** Días de utilidades que paga la empresa (15–120). */
    diasUtilidades: integer('dias_utilidades'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('companies_tenant_rif_uq').on(t.tenantId, t.rif)],
);
