import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { bankAccounts, bankStatements, journalEntries, journalLines, reconciliations, statementLines } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, requireEnum, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { type MovBanco, type MovSistema, type Sugerencia, sugerirConciliaciones, type TipoMatch } from './matching';

/** Línea de banco para la UI de dos columnas. */
export interface LadoBanco {
  readonly id: string;
  readonly fecha: string;
  readonly descripcion: string | null;
  readonly referencia: string | null;
  readonly monto: string;
}
/** Movimiento de sistema para la UI de dos columnas. */
export interface LadoSistema {
  readonly id: string;
  readonly fecha: string;
  readonly descripcion: string;
  readonly monto: string;
}

export interface SugerenciasConciliacion {
  readonly banco: LadoBanco[];
  readonly sistema: LadoSistema[];
  readonly sugerencias: Sugerencia[];
}

interface GrupoInput {
  tipo: TipoMatch;
  score: string | null;
  statementLineIds: string[];
  journalLineIds: string[];
}

/**
 * Conciliación bancaria n:m (P11, docs/06 M4, "feature estrella"). Enfrenta las líneas PENDIENTES del
 * extracto contra los movimientos del sistema (líneas de asiento POSTED sobre la cuenta del banco no
 * conciliadas) con el motor puro {@link sugerirConciliaciones} (1:1, 1:n, n:1). Persiste las
 * conciliaciones agrupadas por `grupo_id` y mueve el estado de las líneas. Todo bajo RLS.
 */
@Injectable()
export class ConciliacionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Sugerencias del motor para una cuenta bancaria (dos columnas + matches con score). */
  async sugerir(companyId: string, bankAccountId: string): Promise<SugerenciasConciliacion> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const banco = await cargarBanco(tx, companyId, bankAccountId);
      const { banco: ladoBanco, sistema: ladoSistema } = await cargarLados(tx, companyId, banco.cuentaId, bankAccountId);
      const movBanco: MovBanco[] = ladoBanco.map((b) => ({ id: b.id, fecha: b.fecha, monto: b.monto, referencia: b.referencia }));
      const movSistema: MovSistema[] = ladoSistema.map((s) => ({ id: s.id, fecha: s.fecha, monto: s.monto, referencia: null }));
      const sugerencias = sugerirConciliaciones(movBanco, movSistema);
      return { banco: ladoBanco, sistema: ladoSistema, sugerencias };
    });
  }

  /** Persiste conciliaciones (grupos n:m). Cada grupo enlaza líneas de banco con líneas de sistema. */
  async conciliar(body: unknown): Promise<{ grupos: number; filas: number }> {
    const e = parseConciliar(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const banco = await cargarBanco(tx, e.companyId, e.bankAccountId);

      let filas = 0;
      for (const grupo of e.grupos) {
        if (grupo.statementLineIds.length === 0 && grupo.journalLineIds.length === 0) {
          throw new BadRequestException('Un grupo de conciliación requiere al menos una línea');
        }
        const grupoId = randomUUID();
        const rows = construirFilas(grupo).map((r) => ({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          bankAccountId: banco.id,
          grupoId,
          statementLineId: r.statementLineId,
          journalLineId: r.journalLineId,
          tipo: grupo.tipo,
          score: grupo.score,
          estado: 'CONCILIADO',
          conciliadoPor: ctx.userId ?? null,
        }));
        await tx.insert(reconciliations).values(rows);
        filas += rows.length;
        if (grupo.statementLineIds.length > 0) {
          await tx
            .update(statementLines)
            .set({ estado: 'CONCILIADO' })
            .where(and(eq(statementLines.companyId, e.companyId), inArray(statementLines.id, grupo.statementLineIds)));
        }
      }

      await this.audit.registrar(tx, { accion: 'tesoreria.conciliar', entidad: 'reconciliations', entidadId: e.bankAccountId, after: { grupos: e.grupos.length, filas } });
      return { grupos: e.grupos.length, filas };
    });
  }

  /** Corre el motor y concilia automáticamente todas las sugerencias. */
  async aceptarSugerencias(companyId: string, bankAccountId: string): Promise<{ grupos: number; filas: number }> {
    const { sugerencias } = await this.sugerir(companyId, bankAccountId);
    if (sugerencias.length === 0) return { grupos: 0, filas: 0 };
    return this.conciliar({
      companyId,
      bankAccountId,
      grupos: sugerencias.map((s) => ({ tipo: s.tipo, score: String(s.score), statementLineIds: s.bancoIds, journalLineIds: s.sistemaIds })),
    });
  }

  /** Marca líneas del extracto como "en tránsito" (partida en conciliación sin contraparte aún). */
  async marcarEnTransito(body: unknown): Promise<{ actualizadas: number }> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const ids = Array.isArray(b.statementLineIds) ? b.statementLineIds.map((x, i) => requireUuid(x, `statementLineIds[${i}]`)) : [];
    if (ids.length === 0) throw new BadRequestException('statementLineIds requerido');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const res = await tx
        .update(statementLines)
        .set({ estado: 'EN_TRANSITO' })
        .where(and(eq(statementLines.companyId, companyId), inArray(statementLines.id, ids)))
        .returning({ id: statementLines.id });
      return { actualizadas: res.length };
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cargarBanco(tx: DatabaseTx, companyId: string, bankAccountId: string): Promise<typeof bankAccounts.$inferSelect> {
  const [banco] = await tx
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, companyId)))
    .limit(1);
  if (banco === undefined) throw new NotFoundException(`Cuenta bancaria ${bankAccountId} no encontrada`);
  return banco;
}

/** Líneas de banco PENDIENTES y movimientos de sistema (POSTED sobre la cuenta) no conciliados. */
async function cargarLados(
  tx: DatabaseTx,
  companyId: string,
  cuentaId: string,
  bankAccountId: string,
): Promise<{ banco: LadoBanco[]; sistema: LadoSistema[] }> {
  const estados = await tx.select({ id: bankStatements.id }).from(bankStatements).where(eq(bankStatements.bankAccountId, bankAccountId));
  const estadoIds = estados.map((s) => s.id);
  const lineasBanco =
    estadoIds.length === 0
      ? []
      : await tx
          .select({ id: statementLines.id, fecha: statementLines.fecha, descripcion: statementLines.descripcion, referencia: statementLines.referencia, monto: statementLines.monto })
          .from(statementLines)
          .where(and(eq(statementLines.companyId, companyId), inArray(statementLines.statementId, estadoIds), eq(statementLines.estado, 'PENDIENTE')));

  const reconciliadas = await tx.select({ journalLineId: reconciliations.journalLineId }).from(reconciliations).where(eq(reconciliations.companyId, companyId));
  const yaConciliadas = new Set(reconciliadas.map((r) => r.journalLineId).filter((x): x is string => x !== null));

  const lineasSistema = await tx
    .select({ id: journalLines.id, fecha: journalEntries.fecha, descripcion: journalEntries.descripcion, dc: journalLines.dc, montoVes: journalLines.montoVes })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalLines.accountId, cuentaId), eq(journalEntries.estado, 'POSTED')));

  return {
    banco: lineasBanco.map((b) => ({ id: b.id, fecha: b.fecha, descripcion: b.descripcion, referencia: b.referencia, monto: b.monto })),
    sistema: lineasSistema
      .filter((s) => !yaConciliadas.has(s.id))
      .map((s) => ({ id: s.id, fecha: isoFecha(s.fecha), descripcion: s.descripcion, monto: s.dc === 'D' ? s.montoVes : `-${s.montoVes}` })),
  };
}

/** Filas (statementLineId, journalLineId) que representan un grupo n:m. */
function construirFilas(grupo: GrupoInput): { statementLineId: string | null; journalLineId: string | null }[] {
  const { statementLineIds: s, journalLineIds: j } = grupo;
  if (s.length === 0) return j.map((id) => ({ statementLineId: null, journalLineId: id }));
  if (j.length === 0) return s.map((id) => ({ statementLineId: id, journalLineId: null }));
  // Emparejado general: cada línea de banco contra la primera de sistema, y el resto de sistema sueltas.
  const primeraJ = j[0] ?? null;
  const rows: { statementLineId: string | null; journalLineId: string | null }[] = s.map((id) => ({ statementLineId: id, journalLineId: primeraJ }));
  for (const id of j.slice(1)) rows.push({ statementLineId: null, journalLineId: id });
  return rows;
}

function isoFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseConciliar(body: unknown): { companyId: string; bankAccountId: string; grupos: GrupoInput[] } {
  const b = asRecord(body);
  if (!Array.isArray(b.grupos) || b.grupos.length === 0) throw new BadRequestException('Se requiere al menos un grupo de conciliación');
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    bankAccountId: requireUuid(b.bankAccountId, 'bankAccountId'),
    grupos: b.grupos.map((g, i) => {
      const r = asRecord(g);
      return {
        tipo: requireEnum(r.tipo, `grupos[${i}].tipo`, ['UNO_A_UNO', 'UNO_A_N', 'N_A_UNO'] as const),
        score: r.score == null ? null : String(r.score),
        statementLineIds: Array.isArray(r.statementLineIds) ? r.statementLineIds.map((x, k) => requireUuid(x, `grupos[${i}].statementLineIds[${k}]`)) : [],
        journalLineIds: Array.isArray(r.journalLineIds) ? r.journalLineIds.map((x, k) => requireUuid(x, `grupos[${i}].journalLineIds[${k}]`)) : [],
      };
    }),
  };
}
