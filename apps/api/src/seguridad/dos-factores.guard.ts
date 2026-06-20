import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getTenantContext } from '../tenant/tenant-context';
import { cumplePoliticaDosFactores } from './dos-factores';
import { PermisosService } from './permisos.service';
import { SeguridadService } from './seguridad.service';

/** Marca un endpoint como exento del 2FA (login, enrolamiento, health). */
export const SIN_2FA_METADATA = 'contave:permite_sin_2fa';
export const PermiteSin2FA = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SIN_2FA_METADATA, true);

/**
 * Exige que los roles obligados a 2FA (owner/admin/contador, docs/05 §6) tengan el segundo factor
 * activo y confirmado para ejecutar acciones protegidas. Una cuenta con poder sobre dinero/cierres
 * no puede operar sin 2FA: si no cumple, 403 `DOS_FACTORES_REQUERIDO` (debe completar el
 * enrolamiento). Los endpoints de login/enrolamiento se marcan con `@PermiteSin2FA()`.
 *
 * Nota de integración: el reto 2FA por SESIÓN (verificar el código en el login) lo aplica el
 * endpoint de login con `SeguridadService.verificar`. Este guard asegura el cumplimiento de cuenta;
 * la verificación por sesión se ata al emitir el token cuando aterrice la capa de auth.
 */
@Injectable()
export class DosFactoresGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosService,
    private readonly seguridad: SeguridadService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exento = this.reflector.getAllAndOverride<boolean | undefined>(SIN_2FA_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exento === true) {
      return true;
    }

    const ctx = getTenantContext();
    if (ctx === undefined || ctx.userId === undefined) {
      return true; // sin actor: lo gobierna el guard de autenticación/permisos
    }

    const rol = await this.permisos.rolDelActor(ctx.tenantId, ctx.userId);
    if (rol === null) {
      return true; // sin membresía: el guard de permisos rechazará la acción protegida
    }

    const estado = await this.seguridad.estado(ctx.userId);
    if (!cumplePoliticaDosFactores(rol, estado)) {
      throw new ForbiddenException({
        codigo: 'DOS_FACTORES_REQUERIDO',
        message: `El rol ${rol} requiere 2FA activo; completá el enrolamiento del segundo factor`,
      });
    }
    return true;
  }
}
