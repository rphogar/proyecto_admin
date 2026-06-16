import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { delegaciones } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type Delegacion = typeof delegaciones.$inferSelect;

/**
 * Delegaciones de permisos por empresa (P16, docs/06 M11, regla 13). El dueño/admin de una empresa
 * concede a otro usuario —típicamente su contador— un subconjunto de acciones para operarla dentro
 * del portal multi-empresa. Una sola delegación vigente por (empresa, usuario): se reotorga con
 * UPSERT (`crear`) y se retira marcándola REVOCADA (`revocar`), nunca se borra, para conservar la
 * traza. Todo queda auditado (regla 5). El enforcement por endpoint lo cablean los guards de auth.
 */
@Injectable()
export class DelegacionesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Otorga (o reotorga) la delegación de `permisos` sobre `companyId` al usuario `userId`. */
  async otorgar(body: unknown): Promise<Delegacion> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const userId = requireUuid(b.userId, 'userId');
    const permisos = parsePermisos(b.permisos);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      const [previa] = await tx
        .select()
        .from(delegaciones)
        .where(and(eq(delegaciones.companyId, companyId), eq(delegaciones.userId, userId)))
        .limit(1);

      const [fila] = await tx
        .insert(delegaciones)
        .values({ tenantId: ctx.tenantId, companyId, userId, permisos, estado: 'ACTIVA', otorgadoPor: ctx.userId ?? null })
        .onConflictDoUpdate({
          target: [delegaciones.companyId, delegaciones.userId],
          set: { permisos, estado: 'ACTIVA', otorgadoPor: ctx.userId ?? null, revokedBy: null, revokedAt: null },
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo otorgar la delegación');

      await this.audit.registrar(tx, { accion: 'portal.delegar', entidad: 'delegaciones', entidadId: fila.id, before: previa, after: fila });
      return fila;
    });
  }

  /** Revoca una delegación (la deja inactiva conservando la traza de quién/cuándo). */
  async revocar(body: unknown): Promise<Delegacion> {
    const id = requireUuid(asRecord(body).id, 'id');
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const [previa] = await tx.select().from(delegaciones).where(eq(delegaciones.id, id)).limit(1);
      if (previa === undefined) throw new NotFoundException(`Delegación ${id} no encontrada en el tenant actual`);
      if (previa.estado === 'REVOCADA') return previa;

      const [fila] = await tx
        .update(delegaciones)
        .set({ estado: 'REVOCADA', revokedBy: ctx.userId ?? null, revokedAt: new Date() })
        .where(eq(delegaciones.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo revocar la delegación');

      await this.audit.registrar(tx, { accion: 'portal.revocar', entidad: 'delegaciones', entidadId: fila.id, before: previa, after: fila });
      return fila;
    });
  }

  /** Lista las delegaciones del tenant; si se pasa `companyId`, solo las de esa empresa. */
  async listar(companyIdRaw?: string): Promise<Delegacion[]> {
    return withTenant(this.database.db, async (tx) => {
      if (companyIdRaw !== undefined && companyIdRaw !== '') {
        const companyId = requireUuid(companyIdRaw, 'companyId');
        await asegurarEmpresaDelTenant(tx, companyId);
        return tx.select().from(delegaciones).where(eq(delegaciones.companyId, companyId)).orderBy(desc(delegaciones.createdAt));
      }
      return tx.select().from(delegaciones).orderBy(desc(delegaciones.createdAt));
    });
  }
}

/** Valida `permisos`: arreglo no vacío de códigos (strings) recortados, deduplicados, con tope. */
function parsePermisos(valor: unknown): string[] {
  if (!Array.isArray(valor)) throw new BadRequestException('permisos debe ser un arreglo de códigos de permiso');
  const codigos = valor.map((v) => String(v ?? '').trim()).filter((s) => s.length > 0);
  if (codigos.length === 0) throw new BadRequestException('permisos debe contener al menos un código');
  for (const c of codigos) {
    if (c.length > 64) throw new BadRequestException(`código de permiso demasiado largo: "${c}"`);
  }
  return [...new Set(codigos)];
}
