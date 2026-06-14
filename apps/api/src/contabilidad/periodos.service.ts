import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { periods } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type Period = typeof periods.$inferSelect;

/**
 * Gestión de períodos contables mensuales (P13). Cubre el GAP previo: hasta ahora nada creaba
 * `periods` en la app (solo las pruebas). `crear` es idempotente sobre la unicidad
 * `(company, anio, mes)`. El cierre y la reapertura del período viven en `CierreMensualService`
 * (el cierre es la acción terminal del wizard; la reapertura exige rol + motivo — caso 43).
 */
@Injectable()
export class PeriodosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Crea (o devuelve, si ya existe) el período OPEN `anio-mes` de la empresa. */
  async crear(body: unknown): Promise<Period> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const anio = optionalInt(b.anio, 'anio', 0, 2000);
    const mes = optionalInt(b.mes, 'mes', 0, 1);
    if (anio < 2000 || mes < 1 || mes > 12) throw new BadRequestException('anio/mes inválidos');

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      const [existente] = await tx
        .select()
        .from(periods)
        .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
        .limit(1);
      if (existente !== undefined) return existente;

      const [fila] = await tx
        .insert(periods)
        .values({ tenantId: ctx.tenantId, companyId, anio, mes, estado: 'OPEN' })
        .returning();
      if (fila === undefined) throw new Error('No se pudo crear el período');

      await this.audit.registrar(tx, { accion: 'contabilidad.periodo_crear', entidad: 'periods', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<Period[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx
        .select()
        .from(periods)
        .where(eq(periods.companyId, companyId))
        .orderBy(asc(periods.anio), asc(periods.mes));
    });
  }
}
