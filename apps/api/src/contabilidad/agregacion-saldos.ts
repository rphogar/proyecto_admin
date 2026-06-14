import { type MovimientoCuenta } from '@contave/ledger';
import { Money } from '@contave/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { accounts, journalEntries, journalLines, periods } from '../db/schema';
import { type ClaveMes, ordinalMes } from './contabilidad-comun';

/**
 * Agregación de movimientos por cuenta en SQL (P13, docs/03 §6). En vez de cargar los Asientos en
 * memoria (lo que hace `balanceDeComprobacion` del ledger), se suma `journal_lines` POSTED por
 * cuenta dentro del rango de períodos, en ambas bases (VES fiscal + USD gerencial). El corte
 * temporal es por PERÍODO FISCAL (`periods.anio/mes` vía `period_id`), consistente con cómo todo el
 * sistema bucketiza el tiempo en Caracas (regla 15). El resultado alimenta las funciones puras del
 * ledger (balance doble base, estados financieros).
 */

export interface RangoPeriodo {
  /** Desde (inclusive). Si se omite, acumula desde el inicio (saldo histórico, p.ej. balance general). */
  readonly desde?: ClaveMes | null;
  /** Hasta (inclusive). */
  readonly hasta: ClaveMes;
}

/** Suma de `journal_lines` POSTED por cuenta en el rango, en doble base. */
export async function movimientosPorCuenta(
  tx: DatabaseTx,
  companyId: string,
  rango: RangoPeriodo,
): Promise<MovimientoCuenta[]> {
  const ord = sql`(${periods.anio} * 12 + ${periods.mes} - 1)`;
  const condiciones = [
    eq(journalLines.companyId, companyId),
    eq(journalEntries.estado, 'POSTED'),
    sql`${ord} <= ${ordinalMes(rango.hasta)}`,
  ];
  if (rango.desde != null) {
    condiciones.push(sql`${ord} >= ${ordinalMes(rango.desde)}`);
  }

  const filas = await tx
    .select({
      codigo: accounts.codigo,
      debeVes: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'D' then ${journalLines.montoVes} else 0 end), 0)`,
      haberVes: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'C' then ${journalLines.montoVes} else 0 end), 0)`,
      debeUsd: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'D' then ${journalLines.montoUsdMgmt} else 0 end), 0)`,
      haberUsd: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'C' then ${journalLines.montoUsdMgmt} else 0 end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(periods, eq(journalEntries.periodId, periods.id))
    .where(and(...condiciones))
    .groupBy(accounts.codigo);

  return filas.map((f) => ({
    cuenta: f.codigo,
    debeVes: Money.of(f.debeVes, 'VES'),
    haberVes: Money.of(f.haberVes, 'VES'),
    debeUsd: Money.of(f.debeUsd, 'USD'),
    haberUsd: Money.of(f.haberUsd, 'USD'),
  }));
}
