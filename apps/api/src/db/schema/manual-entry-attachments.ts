import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `manual_entry_attachments` — soportes (opcionales) de un asiento MANUAL (P13, docs/03 §5: «adjuntos
 * de soporte recomendados»). Tenant-scoped → RLS. Los bytes viven en object-store; aquí solo
 * metadatos + hash sha256 de integridad. Es metadato mutable (sin trigger de inmutabilidad) aunque
 * referencie un asiento POSTED. La unicidad `(entry, hash)` evita adjuntar dos veces el mismo archivo.
 */
export const manualEntryAttachments = pgTable(
  'manual_entry_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'cascade' }),
    nombreArchivo: text('nombre_archivo').notNull(),
    contentType: text('content_type'),
    /** sha256 del archivo (cadena de integridad, Providencia 121). */
    hashArchivo: text('hash_archivo').notNull(),
    /** Clave/URL en el object-store (los bytes no se guardan en PG). */
    storageUrl: text('storage_url'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('manual_entry_attachments_entry_hash_uq').on(t.entryId, t.hashArchivo)],
);
