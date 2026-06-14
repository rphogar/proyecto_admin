import { boolean, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `posting_templates` — plantillas de contabilización VERSIONADAS (P13, docs/03 §5). Mapean un
 * tipo de operación/documento a un patrón de líneas de asiento sobre cuentas del plan. Editables
 * por el contador; al editar NO se muta la versión en uso: se crea una versión nueva y la anterior
 * queda HISTORICA (inmutable), de modo que los documentos contabilizados conservan su versión.
 * Infraestructura ADITIVA: el posting automático existente (ventas/compras/…) no se reescribe.
 * Tenant-scoped → RLS.
 *
 * `version_actual` apunta a la versión VIGENTE. La unicidad `(company, codigo)` identifica la
 * plantilla dentro de la empresa.
 */
export const postingTemplates = pgTable(
  'posting_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Código de la plantilla dentro de la empresa (p.ej. 'COMPRA', 'DEPRECIACION'). */
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** Tipo de operación/documento que esta plantilla contabiliza (informativo/clasificación). */
    operacionTipo: text('operacion_tipo').notNull(),
    /** Número de la versión VIGENTE (FK lógica a posting_template_versions.version). */
    versionActual: integer('version_actual').notNull().default(1),
    activo: boolean('activo').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('posting_templates_company_codigo_uq').on(t.companyId, t.codigo)],
);

/**
 * `posting_template_versions` — una versión de una plantilla. VIGENTE | HISTORICA. La versión
 * HISTORICA es inmutable (trigger en 0042). La unicidad `(template, version)` ordena el historial.
 */
export const postingTemplateVersions = pgTable(
  'posting_template_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => postingTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** VIGENTE | HISTORICA (CHECK en 0042). */
    estado: text('estado').notNull().default('VIGENTE'),
    /** Plantilla del texto de la descripción del asiento generado. */
    descripcionAsiento: text('descripcion_asiento').notNull(),
    notas: text('notas'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('posting_template_versions_template_version_uq').on(t.templateId, t.version)],
);

/**
 * `posting_template_lines` — líneas de una versión de plantilla. Cada línea referencia una cuenta
 * (por código, resuelta a id al aplicar) y una `magnitud` con nombre (clave del monto que el motor
 * recibe en triple base, p.ej. BASE/IVA/NETO/RETENCION_IVA) más el lado D/C y el signo.
 */
export const postingTemplateLines = pgTable(
  'posting_template_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => postingTemplateVersions.id, { onDelete: 'cascade' }),
    lineaNo: integer('linea_no').notNull(),
    /** Código de la cuenta imputada (debe ser de movimiento; se valida al aplicar/postear). */
    cuentaCodigo: text('cuenta_codigo').notNull(),
    /** D | C (CHECK en 0042). */
    dc: text('dc').notNull(),
    /** Clave del monto que esta línea toma del contexto de aplicación. */
    magnitud: text('magnitud').notNull(),
    /** POSITIVO | NEGATIVO: signo con que la magnitud entra en este lado (CHECK en 0042). */
    signo: text('signo').notNull().default('POSITIVO'),
    /** Línea de ajuste (diferencial/redondeo): se excluye del cuadre por moneda origen. */
    esAjuste: boolean('es_ajuste').notNull().default(false),
    /** Si esta línea debe estampar el `party_id` del contexto (CxC/CxP). */
    usaParty: boolean('usa_party').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('posting_template_lines_version_linea_uq').on(t.versionId, t.lineaNo)],
);
