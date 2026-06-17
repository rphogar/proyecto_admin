import { type AnyPgColumn, bigint, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `fiscal_event_log` — bitácora integral de eventos de facturación (P17, docs/05 §3.9, Providencia
 * SNAT/2024/000121 §6.3 req. 1 y 3). Registra TODA interacción relevante con un documento fiscal:
 * emisión, impresión, reimpresión, NC/ND, anulación y **fallos** (intentos que no llegaron a emitir).
 *
 * Diferencia con `audit_events`: aquél audita escrituras de dominio en general; éste es el registro
 * *fiscal* específico que la providencia exige (req. 3: "registro automático de eventos … fechado con
 * fecha y hora"), con encadenamiento criptográfico para garantizar **inalterabilidad e inviolabilidad**
 * (req. 1): cada evento guarda el `hash` del evento previo del mismo tenant (`prev_hash`) y su propio
 * `event_hash = sha256(prev_hash + payload + ts)`. Romper o reordenar la cadena se detecta al verificar.
 *
 * **Append-only** (igual filosofía que `audit_events`/`exchange_rates`): el rol de aplicación solo
 * recibe SELECT/INSERT y un trigger aborta UPDATE/DELETE incluso para el owner (migración 0054).
 * Tenant-scoped → RLS. Se escribe en la MISMA transacción que la operación fiscal (atómico).
 */
export const fiscalEventLog = pgTable('fiscal_event_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  /**
   * Secuencia monótona de inserción (identity). Da el orden determinista de la cadena —el avance del
   * `prev_hash` se ancla a `MAX(seq)` bajo el advisory lock por tenant— sin depender de empates de
   * timestamp bajo concurrencia. No es el "número fiscal" del documento (ese vive en `documents`).
   */
  seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Documento al que refiere el evento. NULL en un FALLO previo a crear el documento. */
  documentId: uuid('document_id').references((): AnyPgColumn => documents.id),
  /** EMISION | IMPRESION | REIMPRESION | NOTA_CREDITO | NOTA_DEBITO | ANULACION | FALLO (CHECK en 0054). */
  eventType: text('event_type').notNull(),
  /** Snapshot del tipo de documento (FACTURA, NOTA_CREDITO, …) al momento del evento. */
  tipoDocumento: text('tipo_documento'),
  /** Snapshot del correlativo y número de control (legibilidad/trazabilidad, req. 1). */
  documentNumber: text('document_number'),
  controlNumber: text('control_number'),
  /** Hash de integridad del documento (el `hash_integridad` de `documents`) al momento del evento. */
  hashDocumento: text('hash_documento'),
  /** Hash del evento inmediatamente anterior del mismo tenant (cadena inviolable, req. 1). */
  prevHash: text('prev_hash'),
  /** sha256(prev_hash + payload canónico + ts_utc): huella encadenada de este evento. */
  eventHash: text('event_hash').notNull(),
  /** Carga del evento (datos del documento, motivo del fallo, etc.). */
  payload: jsonb('payload').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  /** Instante del evento en UTC (verdad de almacenamiento, regla 15). */
  tsUtc: timestamp('ts_utc', { withTimezone: true }).defaultNow().notNull(),
  /** Misma marca en hora legal de Venezuela (ISO con offset −04:00). */
  tsCaracas: text('ts_caracas').notNull(),
  ip: inet('ip'),
  device: text('device'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
