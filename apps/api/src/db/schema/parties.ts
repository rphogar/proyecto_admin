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
import { companies } from './companies';
import { tenants } from './tenants';

/**
 * `parties` — terceros: clientes y/o proveedores (docs/05 §3.2, docs/02 §1–2). Maestro
 * company-scoped → RLS (igual que `accounts`/`periods`): cada empresa lleva su propia cartera,
 * límites de crédito y condición tributaria de la relación. Un mismo RIF puede ser cliente y
 * proveedor: `tipo = 'ambos'`. La unicidad es `(company_id, rif)`.
 *
 * El `rif` se valida con `validarRif` (`@contave/shared`) en la capa de aplicación ANTES de
 * insertar (caso 16: RIF inválido → bloqueo con explicación; forzar requiere permiso + marca de
 * auditoría). Aquí se persiste ya normalizado (`V-XXXXXXXX-X`).
 *
 * Campos del perfil tributario (docs/02 §1.20): condición IVA, si nos retiene IVA (agente) y a
 * qué % (75/100), y si retiene ISLR. Estos flags alimentan el motor fiscal en P7+ (caso 26/27);
 * el perfil será versionable por vigencia en fases posteriores (caso 44).
 */
export const parties = pgTable(
  'parties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** cliente | proveedor | ambos (CHECK en la migración de constraints). */
    tipo: text('tipo').notNull(),
    /** RIF normalizado `V-XXXXXXXX-X` (validado en aplicación). */
    rif: text('rif').notNull(),
    razonSocial: text('razon_social').notNull(),
    /** ordinario | formal | especial | no_contribuyente (consumidor final) — docs/02 §1. */
    condicionIva: text('condicion_iva').notNull().default('ordinario'),
    /** El tercero es agente de retención de IVA (SPE): nos retiene al pagarnos (caso 26). */
    esAgenteRetencionIva: boolean('es_agente_retencion_iva').notNull().default(false),
    /** % de IVA que nos retiene cuando es agente (75 o 100); NULL si no aplica. */
    pctRetencionIva: numeric('pct_retencion_iva', { precision: 5, scale: 2 }),
    /** El tercero es agente de retención de ISLR. */
    esAgenteRetencionIslr: boolean('es_agente_retencion_islr').notNull().default(false),
    direccionFiscal: text('direccion_fiscal'),
    email: text('email'),
    telefono: text('telefono'),
    /** Límite de crédito en la moneda funcional de la empresa (bloqueo suave, doc 06 M3). */
    limiteCredito: numeric('limite_credito', { precision: 20, scale: 8 }),
    /** Días de crédito otorgados (0 = contado). */
    diasCredito: integer('dias_credito').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('parties_company_rif_uq').on(t.companyId, t.rif)],
);
