import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { nominaAri, nominaArc, nominaTrabajadores } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, requireDecimal, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type Ari = typeof nominaAri.$inferSelect;
export type Arc = typeof nominaArc.$inferSelect;

const ORIGENES = ['TRABAJADOR', 'PATRONO'] as const;

/**
 * Retención de ISLR sobre salarios: AR-I y certificado ARC (P15, docs/04 §4). `setAri` registra el
 * % vigente (enero, ajustable marzo/junio/sept/dic) y lo refleja en la ficha. `emitirArc` emite el
 * certificado anual (inmutable una vez emitido, trigger en 0046). Bajo RLS y auditado.
 */
@Injectable()
export class AriArcService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async setAri(body: unknown): Promise<Ari> {
    const e = parseAri(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [fila] = await tx
        .insert(nominaAri)
        .values({ tenantId: ctx.tenantId, companyId: e.companyId, trabajadorId: e.trabajadorId, ejercicio: e.ejercicio, porcentaje: e.porcentaje, vigenteDesde: e.vigenteDesde, origen: e.origen, createdBy: ctx.userId ?? null })
        .returning();
      if (fila === undefined) throw new Error('No se pudo registrar el AR-I');
      // Refleja el % vigente en la ficha del trabajador (lo aplica el cálculo de recibo).
      await tx.update(nominaTrabajadores).set({ ariPorcentaje: e.porcentaje }).where(eq(nominaTrabajadores.id, e.trabajadorId));
      await this.audit.registrar(tx, { accion: 'nomina.ari_set', entidad: 'nomina_ari', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async listarAri(companyId: string, trabajadorId: string): Promise<Ari[]> {
    const cid = requireUuid(companyId, 'companyId');
    const tid = requireUuid(trabajadorId, 'trabajadorId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaAri).where(and(eq(nominaAri.companyId, cid), eq(nominaAri.trabajadorId, tid))).orderBy(nominaAri.vigenteDesde);
    });
  }

  async emitirArc(body: unknown): Promise<Arc> {
    const e = parseArc(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const existente = await tx.select({ id: nominaArc.id, emitidoEn: nominaArc.emitidoEn }).from(nominaArc).where(and(eq(nominaArc.companyId, e.companyId), eq(nominaArc.trabajadorId, e.trabajadorId), eq(nominaArc.ejercicio, e.ejercicio))).limit(1);
      if (existente.length > 0 && existente[0]?.emitidoEn != null) {
        throw new BadRequestException('El ARC de ese ejercicio ya fue emitido (inmutable)');
      }
      const [fila] = await tx
        .insert(nominaArc)
        .values({ tenantId: ctx.tenantId, companyId: e.companyId, trabajadorId: e.trabajadorId, ejercicio: e.ejercicio, totalRemuneracionVes: e.totalRemuneracionVes, totalRetenidoVes: e.totalRetenidoVes, emitidoEn: new Date(), createdBy: ctx.userId ?? null })
        .returning();
      if (fila === undefined) throw new Error('No se pudo emitir el ARC');
      await this.audit.registrar(tx, { accion: 'nomina.arc_emitir', entidad: 'nomina_arc', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async listarArc(companyId: string, ejercicio: number): Promise<Arc[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaArc).where(and(eq(nominaArc.companyId, cid), eq(nominaArc.ejercicio, ejercicio)));
    });
  }
}

interface AriInput {
  companyId: string;
  trabajadorId: string;
  ejercicio: number;
  porcentaje: string;
  vigenteDesde: string;
  origen: (typeof ORIGENES)[number];
}

function parseAri(body: unknown): AriInput {
  const b = asRecord(body);
  const ejercicio = Number(b.ejercicio);
  if (!Number.isInteger(ejercicio) || ejercicio < 2000) throw new BadRequestException('ejercicio inválido');
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    trabajadorId: requireUuid(b.trabajadorId, 'trabajadorId'),
    ejercicio,
    porcentaje: requireDecimal(b.porcentaje, 'porcentaje', true),
    vigenteDesde: requireString(b.vigenteDesde, 'vigenteDesde', 10),
    origen: requireEnum(b.origen ?? 'TRABAJADOR', 'origen', ORIGENES, (s) => s.toUpperCase()),
  };
}

interface ArcInput {
  companyId: string;
  trabajadorId: string;
  ejercicio: number;
  totalRemuneracionVes: string;
  totalRetenidoVes: string;
}

function parseArc(body: unknown): ArcInput {
  const b = asRecord(body);
  const ejercicio = Number(b.ejercicio);
  if (!Number.isInteger(ejercicio) || ejercicio < 2000) throw new BadRequestException('ejercicio inválido');
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    trabajadorId: requireUuid(b.trabajadorId, 'trabajadorId'),
    ejercicio,
    totalRemuneracionVes: requireDecimal(b.totalRemuneracionVes, 'totalRemuneracionVes', true),
    totalRetenidoVes: requireDecimal(b.totalRetenidoVes, 'totalRetenidoVes', true),
  };
}
