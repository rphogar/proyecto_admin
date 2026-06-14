import { Injectable } from '@nestjs/common';
import { Decimal } from '@contave/shared';
import { and, eq, like } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, bankAccounts, journalEntries, journalLines, paymentMethods } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { withTenant } from '../tenant/with-tenant';

/**
 * Posición consolidada de tesorería (P11, docs/06 M4). Los saldos NO se almacenan como verdad: se
 * **derivan del ledger** (regla 8 de CLAUDE.md) sumando las líneas POSTED de las cuentas de Efectivo
 * y equivalentes (1.1.0x) en sus tres bases. Devuelve el saldo por cuenta y por método de pago, y el
 * consolidado en VES y USD (la moneda de vista Bs⇄USD la elige la UI).
 */

const PREFIJO_EFECTIVO = '1.1.%';

/** Saldo derivado de una cuenta de caja/banco. */
export interface SaldoCuenta {
  readonly codigo: string;
  readonly nombre: string;
  readonly moneda: string | null;
  readonly saldoVes: string;
  readonly saldoUsd: string;
}

export interface PosicionTesoreria {
  readonly cuentas: SaldoCuenta[];
  readonly metodos: { readonly codigo: string; readonly nombre: string; readonly cuenta: string; readonly saldoVes: string; readonly saldoUsd: string }[];
  readonly bancos: { readonly id: string; readonly banco: string; readonly nombre: string; readonly moneda: string; readonly cuenta: string; readonly saldoVes: string; readonly saldoUsd: string }[];
  readonly totalVes: string;
  readonly totalUsd: string;
}

@Injectable()
export class PosicionService {
  constructor(private readonly database: DatabaseService) {}

  async consolidada(companyId: string): Promise<PosicionTesoreria> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const saldos = await saldosEfectivo(tx, companyId);

      const cuentas: SaldoCuenta[] = [...saldos.values()].sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
      const totalVes = cuentas.reduce((acc, c) => acc.plus(c.saldoVes), new Decimal(0));
      const totalUsd = cuentas.reduce((acc, c) => acc.plus(c.saldoUsd), new Decimal(0));

      const metodosFilas = await tx
        .select({ codigo: paymentMethods.codigo, nombre: paymentMethods.nombre, cuentaCodigo: accounts.codigo })
        .from(paymentMethods)
        .innerJoin(accounts, eq(paymentMethods.cuentaId, accounts.id))
        .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.activo, true)));
      const metodos = metodosFilas.map((m) => {
        const s = saldos.get(m.cuentaCodigo);
        return { codigo: m.codigo, nombre: m.nombre, cuenta: m.cuentaCodigo, saldoVes: s?.saldoVes ?? '0.00', saldoUsd: s?.saldoUsd ?? '0.00' };
      });

      const bancosFilas = await tx
        .select({ id: bankAccounts.id, banco: bankAccounts.banco, nombre: bankAccounts.nombre, moneda: bankAccounts.moneda, cuentaCodigo: accounts.codigo })
        .from(bankAccounts)
        .innerJoin(accounts, eq(bankAccounts.cuentaId, accounts.id))
        .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.activo, true)));
      const bancos = bancosFilas.map((b) => {
        const s = saldos.get(b.cuentaCodigo);
        return { id: b.id, banco: b.banco, nombre: b.nombre, moneda: b.moneda, cuenta: b.cuentaCodigo, saldoVes: s?.saldoVes ?? '0.00', saldoUsd: s?.saldoUsd ?? '0.00' };
      });

      return { cuentas, metodos, bancos, totalVes: totalVes.toFixed(2), totalUsd: totalUsd.toFixed(2) };
    });
  }
}

/** Mapa código→saldo derivado de las cuentas 1.1.0x a partir de las líneas POSTED. */
async function saldosEfectivo(tx: DatabaseTx, companyId: string): Promise<Map<string, SaldoCuenta>> {
  const filas = await tx
    .select({
      codigo: accounts.codigo,
      nombre: accounts.nombre,
      moneda: accounts.moneda,
      dc: journalLines.dc,
      montoVes: journalLines.montoVes,
      montoUsdMgmt: journalLines.montoUsdMgmt,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalEntries.estado, 'POSTED'), like(accounts.codigo, PREFIJO_EFECTIVO)));

  const acc = new Map<string, { codigo: string; nombre: string; moneda: string | null; ves: Decimal; usd: Decimal }>();
  for (const f of filas) {
    const m = acc.get(f.codigo) ?? { codigo: f.codigo, nombre: f.nombre, moneda: f.moneda, ves: new Decimal(0), usd: new Decimal(0) };
    const signo = f.dc === 'D' ? 1 : -1; // caja/banco son cuentas deudoras: débito suma, crédito resta.
    m.ves = m.ves.plus(new Decimal(f.montoVes).times(signo));
    m.usd = m.usd.plus(new Decimal(f.montoUsdMgmt).times(signo));
    acc.set(f.codigo, m);
  }

  return new Map(
    [...acc.entries()].map(([k, v]) => [k, { codigo: v.codigo, nombre: v.nombre, moneda: v.moneda, saldoVes: v.ves.toFixed(2), saldoUsd: v.usd.toFixed(2) }]),
  );
}
