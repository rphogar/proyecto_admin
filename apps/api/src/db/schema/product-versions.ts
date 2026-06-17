import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * `product_versions` — versionado formal del producto y estado de homologación (P17, docs/05 §3.9,
 * Providencia 121 §6.3 req. 6: "cada nueva versión del sistema requiere nueva homologación" →
 * mantener versionado formal y un expediente de homologación actualizado).
 *
 * Tabla **global del producto** (no tenant-scoped): la versión del sistema es la misma para todos los
 * tenants, igual que un catálogo de referencia. Por eso NO lleva `tenant_id` ni RLS; el rol de
 * aplicación solo recibe SELECT (las versiones las publica el proveedor vía migración/seed, no los
 * tenants). El expediente técnico (`GET /cumplimiento/expediente`) referencia la versión vigente.
 */
export const productVersions = pgTable('product_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  /** Versión semántica del producto (única). */
  version: text('version').notNull(),
  changelog: text('changelog').notNull(),
  /** DESARROLLO | SOLICITADA | HOMOLOGADA | RECHAZADA (CHECK en 0054). */
  estadoHomologacion: text('estado_homologacion').notNull().default('DESARROLLO'),
  /** Huella del artefacto de build homologado (inviolabilidad del binario, req. 5). */
  hashArtefacto: text('hash_artefacto'),
  /** Nº de resolución/acto administrativo del SENIAT cuando se homologa. */
  nroResolucion: text('nro_resolucion'),
  /** Fecha desde la que esta versión rige en producción. */
  vigenteDesde: date('vigente_desde'),
  notas: text('notas'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
