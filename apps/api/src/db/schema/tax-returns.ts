import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { tenants } from './tenants';
import { users } from './users';

/**
 * `tax_returns` — declaraciones tributarias por período (P10, docs/05 §3.7, docs/06 M7). Tenant-scoped
 * → RLS. Una fila por (empresa, tipo, período).
 *
 * La planilla **borrador** se calcula en vivo desde la única fuente de verdad (los libros, que a su
 * vez salen de `document_taxes`/`purchase_taxes`): no se almacena. Al **marcar como presentada** se
 * congela un `snapshot` jsonb inmutable con todas las cifras de la planilla y de los libros en ese
 * instante, el número de declaración y el sello de tiempo (Providencia 121: inalterabilidad y
 * trazabilidad). Una vez `status='PRESENTADA'` la fila NO admite UPDATE ni DELETE: lo hace cumplir el
 * trigger `tax_returns_inmutable` (migración 0030) además de la capa de aplicación; una corrección
 * posterior se hace con una declaración sustitutiva (nuevo período/identificador), nunca editando.
 *
 * El snapshot es autocontenido y reconstruible: guarda el resumen del Libro de Ventas y de Compras y
 * el resultado de la planilla, de modo que reproduce exactamente lo declarado aunque luego entren
 * notas de crédito o ajustes en períodos posteriores.
 */
export const taxReturns = pgTable(
  'tax_returns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** IVA | ISLR | IGTF | RET_IVA | RET_ISLR | ISAE | ANTICIPO_IVA | ANTICIPO_ISLR (CHECK en 0030/0059). */
    tipo: text('tipo').notNull(),
    periodoAnio: integer('periodo_anio').notNull(),
    periodoMes: integer('periodo_mes').notNull(),
    /**
     * Fracción dentro del mes para los anticipos quincenales/semanales de SPE (P21): 0 = declaración
     * mensual (IVA/IGTF/…); 1..N = número de quincena/semana del régimen de anticipos. Permite varias
     * declaraciones por (empresa, tipo, mes) sin romper la unicidad (CHECK/UNIQUE en 0059).
     */
    subperiodo: integer('subperiodo').notNull().default(0),
    /** BORRADOR | PRESENTADA (CHECK en 0030). PRESENTADA es inmutable. */
    status: text('status').notNull().default('BORRADOR'),
    /** Número de la declaración/recibo asignado por el portal SENIAT al presentar. */
    numeroDeclaracion: text('numero_declaracion'),
    /** Cifras congeladas al presentar (planilla + resúmenes de libros). Inmutable. */
    snapshot: jsonb('snapshot'),
    /** Hash de integridad del snapshot (cadena inviolable, Providencia 121). */
    hashIntegridad: text('hash_integridad'),
    /** Instante de presentación (UTC); NULL mientras es BORRADOR. */
    presentadoAt: timestamp('presentado_at', { withTimezone: true }),
    presentadoPor: uuid('presentado_por').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique('tax_returns_company_tipo_periodo_uq').on(t.companyId, t.tipo, t.periodoAnio, t.periodoMes, t.subperiodo)],
);
