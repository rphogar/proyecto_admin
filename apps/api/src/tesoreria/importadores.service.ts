import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { bankAccounts, bankStatements, statementLines } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { parsearEstado } from './parsers/registro';

interface ImportarInput {
  companyId: string;
  bankAccountId: string;
  archivoNombre: string;
  contenido: string;
  bancoEsperado: string | null;
}

export interface ResultadoImportacion {
  readonly statement: typeof bankStatements.$inferSelect;
  readonly lineasInsertadas: number;
  /** True si el archivo ya se había importado (idempotencia: no se duplicó nada). */
  readonly yaImportado: boolean;
}

/**
 * Importador de estados de cuenta bancarios (P11, docs/06 M4, F1). Detecta el formato, elige el
 * parser versionado y persiste `bank_statements` + `statement_lines`. **Idempotente** (lección del
 * caso 11): el `hash_archivo` (sha256 del contenido) es único por empresa; re-importar el mismo
 * archivo devuelve el estado existente sin duplicar movimientos.
 */
@Injectable()
export class ImportadoresService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async importar(body: unknown): Promise<ResultadoImportacion> {
    const e = parse(body);
    const hashArchivo = createHash('sha256').update(e.contenido).digest('hex');

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const [banco] = await tx
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, e.bankAccountId), eq(bankAccounts.companyId, e.companyId)))
        .limit(1);
      if (banco === undefined) throw new NotFoundException(`Cuenta bancaria ${e.bankAccountId} no encontrada`);

      // Idempotencia: si ya se importó este archivo, no se duplica nada.
      const [existente] = await tx
        .select()
        .from(bankStatements)
        .where(and(eq(bankStatements.companyId, e.companyId), eq(bankStatements.hashArchivo, hashArchivo)))
        .limit(1);
      if (existente !== undefined) {
        return { statement: existente, lineasInsertadas: 0, yaImportado: true };
      }

      const parseado = parsearEstado(e.contenido, e.archivoNombre, e.bancoEsperado ?? banco.banco);
      if (parseado.lineas.length === 0) throw new BadRequestException('El estado de cuenta no contiene movimientos legibles');

      const [statement] = await tx
        .insert(bankStatements)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          bankAccountId: banco.id,
          banco: banco.banco,
          parserVersion: parseado.parserVersion,
          archivoNombre: e.archivoNombre,
          hashArchivo,
          desde: parseado.desde,
          hasta: parseado.hasta,
          saldoInicial: parseado.saldoInicial,
          saldoFinal: parseado.saldoFinal,
          importadoPor: ctx.userId ?? null,
        })
        .returning();
      if (statement === undefined) throw new Error('No se pudo registrar el estado de cuenta');

      const filas = parseado.lineas.map((l, i) => ({
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        statementId: statement.id,
        fecha: l.fecha,
        descripcion: l.descripcion,
        referencia: l.referencia,
        monto: l.monto,
        moneda: l.moneda,
        saldo: l.saldo,
        hashLinea: createHash('sha256').update(`${i}|${l.fecha}|${l.referencia ?? ''}|${l.monto}|${l.descripcion}`).digest('hex'),
        estado: 'PENDIENTE',
      }));
      await tx.insert(statementLines).values(filas);

      await this.audit.registrar(tx, { accion: 'tesoreria.importar', entidad: 'bank_statements', entidadId: statement.id, after: { statement, lineas: filas.length } });
      return { statement, lineasInsertadas: filas.length, yaImportado: false };
    });
  }

  async listarEstados(companyId: string): Promise<(typeof bankStatements.$inferSelect)[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(bankStatements).where(eq(bankStatements.companyId, companyId));
    });
  }
}

function parse(body: unknown): ImportarInput {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    bankAccountId: requireUuid(b.bankAccountId, 'bankAccountId'),
    archivoNombre: requireString(b.archivoNombre, 'archivoNombre', 200),
    contenido: requireString(b.contenido, 'contenido', 5_000_000),
    bancoEsperado: optionalString(b.bancoEsperado, 'bancoEsperado', 20),
  };
}
