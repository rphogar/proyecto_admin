import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { getTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { PermisosService } from './permisos.service';
import { PERMISO_METADATA } from './requiere-permiso.decorator';

/**
 * Guard de RBAC por acción. Si el handler declara `@RequierePermiso(...)`, exige que el actor de
 * la petición tenga ese permiso vía su rol (regla 13). Una denegación produce **403 con código de
 * regla** y un evento de auditoría `access.denied` (caso 54: el cajero que intenta cerrar período
 * o ver salarios queda registrado). Los endpoints sin decorador no se ven afectados.
 */
@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosService,
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permiso = this.reflector.getAllAndOverride<string | undefined>(PERMISO_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (permiso === undefined) {
      return true; // endpoint sin requisito de permiso
    }

    const ctx = getTenantContext();
    if (ctx === undefined || ctx.userId === undefined) {
      // Sin actor identificado no hay forma de autorizar una acción protegida.
      throw new UnauthorizedException('Se requiere autenticación para esta acción');
    }

    const rol = await this.permisos.rolDelActor(ctx.tenantId, ctx.userId);
    const autorizado = rol !== null && (await this.permisos.permisosDeRol(rol)).has(permiso);
    if (!autorizado) {
      await this.auditarDenegacion(permiso, rol);
      throw new ForbiddenException({
        codigo: 'RBAC_PERMISO_DENEGADO',
        message: `El rol ${rol ?? 'sin membresía'} no tiene el permiso ${permiso}`,
        permiso,
      });
    }
    return true;
  }

  /** Registra la denegación en la bitácora append-only (atómica, en su propia transacción). */
  private async auditarDenegacion(permiso: string, rol: string | null): Promise<void> {
    try {
      await withTenant(this.database.db, (tx) =>
        this.audit.registrar(tx, {
          accion: 'access.denied',
          entidad: 'authorization',
          after: { permiso, rol },
        }),
      );
    } catch {
      // La auditoría no debe convertir un 403 en un 500; el rechazo procede igual.
    }
  }
}
