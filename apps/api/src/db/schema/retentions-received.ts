import { date, integer, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { documents } from './documents';
import { journalEntries } from './journal-entries';
import { parties } from './parties';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `retentions_received` — comprobantes de retención que NOS emitieron nuestros clientes agentes
 * (SPE) cuando nos pagaron (P9, docs/05 §3.7, docs/02 §3.3; casos 26 y 28). Tenant-scoped → RLS.
 *
 * Para el retenido (nosotros), el comprobante de IVA es un **crédito descontable** de la cuota de
 * IVA (pasa a 1.3.02 "Retenciones de IVA soportadas"); el de ISLR pasa a 1.3.03. Se imputa en el
 * **período en que se recibe** (caso 28: factura de enero con comprobante que llega en marzo se
 * aplica en marzo) → `periodo_anio`/`periodo_mes` = período de imputación, independiente de la fecha
 * del comprobante. Registrar el comprobante genera un asiento (D 1.3.02/1.3.03 ; C Clientes), que
 * salda la porción retenida de la cuenta por cobrar de la factura afectada (caso 26).
 *
 * Inmutable una vez registrado (regla 4): trigger en 0026. `document_id` es la factura de venta
 * afectada (puede quedar NULL si aún no se concilia con una factura concreta).
 */
export const retentionsReceived = pgTable(
  'retentions_received',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Factura de venta afectada (la que el cliente nos retuvo); NULL si aún sin conciliar. */
    documentId: uuid('document_id').references(() => documents.id),
    /** Cliente agente que nos retuvo. */
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id),
    agenteRif: text('agente_rif').notNull(),
    agenteNombre: text('agente_nombre').notNull(),
    /** IVA | ISLR (CHECK en 0026). */
    tipo: text('tipo').notNull(),
    /** Número de comprobante del agente (`AAAAMMNNNNNNNN`). */
    numeroComprobante: text('numero_comprobante').notNull(),
    /** Período de IMPUTACIÓN = período en que se recibe el comprobante (caso 28). */
    periodoAnio: integer('periodo_anio').notNull(),
    periodoMes: integer('periodo_mes').notNull(),
    /** Concepto (solo ISLR). */
    conceptoIslr: text('concepto_islr'),
    currency: text('currency').notNull(),
    rateBcv: numeric('rate_bcv', { precision: 20, scale: 8 }),
    rateUsdMgmt: numeric('rate_usd_mgmt', { precision: 20, scale: 8 }),
    baseOrigen: numeric('base_origen', { precision: 20, scale: 8 }).notNull(),
    baseVes: numeric('base_ves', { precision: 20, scale: 8 }).notNull(),
    porcentaje: numeric('porcentaje', { precision: 5, scale: 2 }).notNull(),
    /** Monto retenido en triple base. */
    montoOrigen: numeric('monto_origen', { precision: 20, scale: 8 }).notNull(),
    montoVes: numeric('monto_ves', { precision: 20, scale: 8 }).notNull(),
    montoUsdMgmt: numeric('monto_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    /** Fecha del comprobante del agente (Caracas). */
    fechaComprobante: date('fecha_comprobante').notNull(),
    /** Fecha en que lo recibimos (Caracas); define el período de imputación. */
    fechaRecepcion: date('fecha_recepcion').notNull(),
    /** Asiento generado al registrar el comprobante (D 1.3.02/1.3.03 ; C Clientes). */
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    hashIntegridad: text('hash_integridad'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('retentions_received_company_agente_numero_uq').on(t.companyId, t.partyId, t.numeroComprobante)],
);
