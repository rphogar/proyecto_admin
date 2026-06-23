import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `segregacion_deberes` — configuración por tenant de la **separación de deberes** (regla 13,
 * docs/05 §6: "quien aprueba nómina ≠ quien la crea (configurable)"). Cada fila habilita/deshabilita
 * una `regla` con clave estable (p.ej. `nomina.aprobar_distinto_creador`,
 * `tesoreria.concilia_distinto_registra`).
 *
 * **Semántica: la ausencia de fila = regla ACTIVA (default seguro).** Solo se materializa una fila
 * para DESACTIVAR una regla (o reactivarla). Así un tenant nuevo queda protegido sin necesidad de
 * seed por tenant, y la lista de reglas conocidas vive en el código (`SegregacionService`).
 *
 * Tenant-scoped → RLS (`0074`). El enforcement reusa el patrón de `ajustes.service.ts` (quien
 * aprueba ≠ quien creó).
 */
export const segregacionDeberes = pgTable(
  'segregacion_deberes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    regla: text('regla').notNull(),
    activo: boolean('activo').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('segregacion_deberes_tenant_regla_uq').on(t.tenantId, t.regla)],
);
