import { randomUUID } from 'node:crypto';
import type { Asiento } from '@contave/ledger';
import type { DatabaseTx } from '../db/database.service';
import { journalEntries, journalLines } from '../db/schema';

/** Contexto de persistencia de un asiento (resuelto dentro de la transacción de emisión). */
export interface ContextoAsiento {
  readonly tenantId: string;
  readonly companyId: string;
  readonly periodId: string;
  readonly createdBy?: string | null;
  /** Mapa código de cuenta → id, de la empresa (plan de cuentas sembrado). */
  readonly cuentas: ReadonlyMap<string, string>;
}

/**
 * Persiste un asiento POSTED (cabecera + líneas) dentro de la transacción actual, resolviendo los
 * códigos de cuenta a id. El CHECK diferido de cuadre (ΣD=ΣC en triple base) y la verificación de
 * período abierto los imponen los triggers del ledger (migración 0006); esto solo inserta. Devuelve
 * el id del asiento, que el documento referencia (`journal_entry_id`).
 */
export async function persistirAsiento(tx: DatabaseTx, asiento: Asiento, ctx: ContextoAsiento): Promise<string> {
  const entryId = asiento.id ?? randomUUID();

  await tx.insert(journalEntries).values({
    id: entryId,
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    fecha: asiento.fecha,
    periodId: ctx.periodId,
    estado: 'POSTED',
    sourceType: asiento.sourceType ?? null,
    sourceId: asiento.sourceId ?? null,
    descripcion: asiento.descripcion,
    createdBy: ctx.createdBy ?? null,
  });

  const filas = asiento.lineas.map((l, i) => {
    const accountId = ctx.cuentas.get(l.cuenta);
    if (accountId === undefined) {
      throw new Error(`La cuenta "${l.cuenta}" no existe en el plan de la empresa (¿plan sembrado?)`);
    }
    return {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      entryId,
      accountId,
      lineaNo: i + 1,
      dc: l.dc,
      moneda: l.moneda,
      montoOrigen: l.montoOrigen.aCadenaDecimal(),
      rateBcv: l.rateBcv?.toFixed() ?? null,
      montoVes: l.montoVes.aCadenaDecimal(),
      montoUsdMgmt: l.montoUsdMgmt.aCadenaDecimal(),
      rateUsdMgmt: l.rateUsdMgmt?.toFixed() ?? null,
      esAjuste: l.esAjuste,
      partyId: l.partyId ?? null,
      sucursalId: l.sucursalId ?? null,
      centroCosto: l.centroCosto ?? null,
      vencimiento: l.vencimiento ?? null,
    };
  });

  await tx.insert(journalLines).values(filas);
  return entryId;
}
