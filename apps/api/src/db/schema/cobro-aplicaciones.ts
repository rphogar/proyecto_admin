import { numeric, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { cobros } from './cobros';
import { companies } from './companies';
import { documents } from './documents';
import { tenants } from './tenants';

/**
 * `cobro_aplicaciones` — imputación de un cobro a las facturas que salda (docs/06 M3). Tenant-scoped
 * → RLS. Permite aplicar un cobro a una o varias facturas; el monto aplicado va en triple base. El
 * saldo pendiente de una factura se deriva (total − Σ aplicado), nunca se almacena (regla 8).
 */
export const cobroAplicaciones = pgTable(
  'cobro_aplicaciones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    cobroId: uuid('cobro_id')
      .notNull()
      .references(() => cobros.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    montoAplicadoOrigen: numeric('monto_aplicado_origen', { precision: 20, scale: 8 }).notNull(),
    montoAplicadoVes: numeric('monto_aplicado_ves', { precision: 20, scale: 8 }).notNull(),
    montoAplicadoUsdMgmt: numeric('monto_aplicado_usd_mgmt', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('cobro_aplicaciones_cobro_documento_uq').on(t.cobroId, t.documentId)],
);
