import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { accounts, bankAccounts } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

const BANCOS = ['BANESCO', 'MERCANTIL', 'BNC', 'PROVINCIAL', 'BDV', 'OTRO'] as const;
const MONEDAS = ['VES', 'USD', 'EUR', 'USDT'] as const;

export type BankAccount = typeof bankAccounts.$inferSelect;

/** Maestro de cuentas bancarias propias (P11, docs/06 M4/M12). Cada una mapea a una cuenta del plan. */
@Injectable()
export class BancosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async crear(body: unknown): Promise<BankAccount> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const banco = requireEnum(b.banco, 'banco', BANCOS, (s) => s.toUpperCase());
    const nombre = requireString(b.nombre, 'nombre', 120);
    const numeroMascara = requireString(b.numeroMascara, 'numeroMascara', 8);
    const moneda = requireEnum(b.moneda, 'moneda', MONEDAS, (s) => s.toUpperCase());
    const cuentaCodigo = requireString(b.cuentaCodigo, 'cuentaCodigo', 20);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);
      const [cuenta] = await tx
        .select({ id: accounts.id, esMovimiento: accounts.esMovimiento })
        .from(accounts)
        .where(and(eq(accounts.companyId, companyId), eq(accounts.codigo, cuentaCodigo)))
        .limit(1);
      if (cuenta === undefined) throw new BadRequestException(`La cuenta contable ${cuentaCodigo} no existe en el plan`);
      if (!cuenta.esMovimiento) throw new BadRequestException(`La cuenta ${cuentaCodigo} es totalizadora; use una cuenta de movimiento`);

      const [fila] = await tx
        .insert(bankAccounts)
        .values({ tenantId: ctx.tenantId, companyId, banco, nombre, numeroMascara, moneda, cuentaId: cuenta.id })
        .returning();
      if (fila === undefined) throw new Error('No se pudo crear la cuenta bancaria');
      await this.audit.registrar(tx, { accion: 'tesoreria.banco.create', entidad: 'bank_accounts', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<BankAccount[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(bankAccounts).where(eq(bankAccounts.companyId, companyId));
    });
  }
}
