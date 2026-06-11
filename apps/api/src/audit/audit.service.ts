import { Injectable } from '@nestjs/common';
import { instanteCaracasISO } from '@contave/shared';
import type { DatabaseTx } from '../db/database.service';
import { auditEvents } from '../db/schema';
import { requireTenantContext } from '../tenant/tenant-context';

/** Evento de dominio a auditar (regla 5 de CLAUDE.md). */
export interface EventoAuditoria {
  /** Acción de dominio: 'company.create', 'period.close', … */
  accion: string;
  /** Entidad/tabla afectada: 'companies', 'memberships', … */
  entidad: string;
  entidadId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Registra eventos en `audit_events` (append-only). DEBE invocarse dentro de la MISMA
 * transacción de tenant (`withTenant`) que la operación auditada: así el registro es atómico
 * con el cambio y la política de RLS (WITH CHECK) acepta la fila. El "quién/desde dónde" sale
 * del contexto de la petición; el "cuándo" se guarda en UTC y en hora legal de Venezuela.
 */
@Injectable()
export class AuditService {
  async registrar(tx: DatabaseTx, evento: EventoAuditoria): Promise<void> {
    const ctx = requireTenantContext();
    const ahora = new Date();

    await tx.insert(auditEvents).values({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId ?? null,
      accion: evento.accion,
      entidad: evento.entidad,
      entidadId: evento.entidadId ?? null,
      before: evento.before ?? null,
      after: evento.after ?? null,
      tsUtc: ahora,
      tsCaracas: instanteCaracasISO(ahora),
      ip: ctx.ip ?? null,
      device: ctx.device ?? null,
    });
  }
}
