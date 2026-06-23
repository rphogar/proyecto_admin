import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { segregacionDeberes } from '../db/schema';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

/**
 * Reglas de separación de deberes conocidas (P29, docs/05 §6). La clave es estable y se referencia
 * desde el enforcement (`exigirDistinto`). La descripción alimenta la UI de configuración (M12).
 * Agregar una regla nueva = una entrada acá + una llamada a `exigirDistinto` en el servicio dueño
 * de la acción.
 */
export const REGLAS_SEGREGACION = {
  'nomina.aprobar_distinto_creador':
    'En nómina, quien aprueba una corrida no puede ser quien la creó',
  'tesoreria.concilia_distinto_registra':
    'En tesorería, quien concilia un extracto no puede ser quien lo registró/importó',
} as const;

export type ReglaSegregacion = keyof typeof REGLAS_SEGREGACION;

/** Estado de una regla para la UI: su clave, descripción y si está activa en el tenant. */
export interface EstadoReglaSegregacion {
  regla: ReglaSegregacion;
  descripcion: string;
  activo: boolean;
}

/**
 * Separación de deberes CONFIGURABLE por tenant (regla 13). La configuración vive en
 * `segregacion_deberes`, con la semántica **ausencia de fila = regla ACTIVA** (default seguro): solo
 * se materializa una fila para desactivar (o reactivar) una regla. El enforcement reutiliza el
 * patrón de `ajustes.service.ts` (quien aprueba ≠ quien creó) de forma genérica.
 */
@Injectable()
export class SegregacionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Estado de todas las reglas conocidas en el tenant en contexto (para el panel de M12). */
  async listar(): Promise<EstadoReglaSegregacion[]> {
    return withTenant(this.database.db, async (tx) => {
      const filas = await tx
        .select({ regla: segregacionDeberes.regla, activo: segregacionDeberes.activo })
        .from(segregacionDeberes);
      const porRegla = new Map(filas.map((f) => [f.regla, f.activo]));
      return (Object.keys(REGLAS_SEGREGACION) as ReglaSegregacion[]).map((regla) => ({
        regla,
        descripcion: REGLAS_SEGREGACION[regla],
        // Ausencia de fila ⇒ activa (default seguro).
        activo: porRegla.get(regla) ?? true,
      }));
    });
  }

  /** Activa/desactiva una regla en el tenant (upsert), dejando traza en `audit_events`. */
  async configurar(regla: ReglaSegregacion, activo: boolean): Promise<EstadoReglaSegregacion> {
    if (!(regla in REGLAS_SEGREGACION)) {
      throw new ForbiddenException(`Regla de segregación desconocida: ${regla}`);
    }
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const [previo] = await tx
        .select({ id: segregacionDeberes.id, activo: segregacionDeberes.activo })
        .from(segregacionDeberes)
        .where(eq(segregacionDeberes.regla, regla))
        .limit(1);
      if (previo === undefined) {
        await tx.insert(segregacionDeberes).values({
          tenantId: ctx.tenantId,
          regla,
          activo,
          updatedBy: ctx.userId ?? null,
        });
      } else {
        await tx
          .update(segregacionDeberes)
          .set({ activo, updatedBy: ctx.userId ?? null, updatedAt: new Date() })
          .where(eq(segregacionDeberes.id, previo.id));
      }
      await this.audit.registrar(tx, {
        accion: 'segregacion.configurar',
        entidad: 'segregacion_deberes',
        before: previo === undefined ? null : { regla, activo: previo.activo },
        after: { regla, activo },
      });
      return { regla, descripcion: REGLAS_SEGREGACION[regla], activo };
    });
  }

  /**
   * Exige que `actor` sea distinto de `creador` cuando la regla está activa. Pensado para llamarse
   * DENTRO de la transacción de la acción aprobada (reusa el `app.tenant_id` ya fijado). Si la regla
   * está desactivada para el tenant, o si alguno de los dos usuarios es desconocido, no bloquea
   * (mismo criterio que `ajustes.service.ts`).
   */
  async exigirDistinto(
    tx: DatabaseTx,
    regla: ReglaSegregacion,
    creadorUserId: string | null,
    actorUserId: string | null,
  ): Promise<void> {
    if (creadorUserId === null || actorUserId === null || creadorUserId !== actorUserId) {
      return; // distintos o desconocidos → nada que exigir
    }
    const [fila] = await tx
      .select({ activo: segregacionDeberes.activo })
      .from(segregacionDeberes)
      .where(eq(segregacionDeberes.regla, regla))
      .limit(1);
    const activa = fila?.activo ?? true; // ausencia de fila ⇒ activa
    if (activa) {
      throw new ForbiddenException(
        `Separación de deberes (${regla}): la acción debe ejecutarla un usuario distinto al que la originó`,
      );
    }
  }
}
