import { date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { companies } from './companies';
import { journalEntries } from './journal-entries';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `cierres_caja` — cierre de caja por turno con arqueo (P11, docs/06 M1 POS / M4, caso 5).
 * Tenant-scoped → RLS. Al cerrar, el sistema deriva lo **esperado por método** del período del turno
 * (movimientos reales, que distinguen método — incluido el vuelto cruzado del caso 5) y lo compara
 * contra lo **declarado** (conteo físico): la diferencia por método va a una cuenta de
 * faltantes (6.x gasto) / sobrantes (4.6 ingreso) mediante el asiento `journal_entry_id`.
 *
 * El detalle por método vive en `cierre_caja_arqueos`. Un cierre CERRADO es **inmutable** (regla 4):
 * trigger en 0034 además de la capa de aplicación. La fecha fiscal (Caracas) corta el período.
 */
export const cierresCaja = pgTable('cierres_caja', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  /** Ventana del turno (UTC). La fecha fiscal/período se derivan del cierre en Caracas. */
  apertura: timestamp('apertura', { withTimezone: true }).notNull(),
  cierre: timestamp('cierre', { withTimezone: true }),
  fechaFiscal: date('fecha_fiscal').notNull(),
  /** Asiento de la diferencia de arqueo (faltante/sobrante); NULL si no hubo diferencia. */
  journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
  /** Diferencia total del arqueo en Bs (firmado: + sobrante / − faltante). */
  totalDiferenciaVes: numeric('total_diferencia_ves', { precision: 20, scale: 8 }),
  /** ABIERTO | CERRADO (CHECK en 0034). */
  status: text('status').notNull().default('ABIERTO'),
  hashIntegridad: text('hash_integridad'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
