import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { asRecord, optionalBoolean, requireString, requireUuid } from '../maestros/validacion';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import { type CatalogoRbac } from '../seguridad/permisos.service';
import { REGLAS_SEGREGACION, type ReglaSegregacion, SegregacionService } from './segregacion.service';
import {
  type InvitacionDto,
  type MiembroDto,
  type RolAsignable,
  UsuariosService,
} from './usuarios.service';

/**
 * Gestión de usuarios por tenant (P29, docs/06 M12). Va bajo `TenantContextMiddleware` (el actor y
 * el tenant salen del JWT, P28) y exige permisos de acción (`usuario.ver` para lecturas,
 * `usuario.gestionar` para mutaciones; seed en 0076). La transferencia de propiedad no es un
 * permiso: el servicio exige `rol = 'owner'`. La aceptación de invitación, que es PRE-tenant, vive
 * en `InvitacionesController` (excluido del middleware).
 */
@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuarios: UsuariosService,
    private readonly segregacion: SegregacionService,
  ) {}

  // ── Lecturas (usuario.ver) ──────────────────────────────────────────────────
  @RequierePermiso('usuario.ver')
  @Get()
  async listar(): Promise<MiembroDto[]> {
    return this.usuarios.listarMiembros();
  }

  @RequierePermiso('usuario.ver')
  @Get('invitaciones')
  async invitaciones(): Promise<InvitacionDto[]> {
    return this.usuarios.listarInvitaciones();
  }

  @RequierePermiso('usuario.ver')
  @Get('roles')
  async roles(): Promise<CatalogoRbac> {
    return this.usuarios.catalogoRoles();
  }

  @RequierePermiso('usuario.ver')
  @Get('segregacion')
  async listarSegregacion(): Promise<unknown> {
    return this.segregacion.listar();
  }

  // ── Mutaciones (usuario.gestionar) ──────────────────────────────────────────
  @RequierePermiso('usuario.gestionar')
  @Post('invitar')
  @HttpCode(201)
  async invitar(@Body() body: unknown): Promise<{ invitationId: string; tokenDev?: string }> {
    const datos = asRecord(body);
    const email = requireString(datos.email, 'email', 320);
    const rol = requireString(datos.rol, 'rol', 32) as RolAsignable;
    return this.usuarios.invitar(email, rol);
  }

  @RequierePermiso('usuario.gestionar')
  @Post('invitaciones/:id/revocar')
  @HttpCode(204)
  async revocarInvitacion(@Param('id') id: string): Promise<void> {
    await this.usuarios.revocarInvitacion(requireUuid(id, 'id'));
  }

  @RequierePermiso('usuario.gestionar')
  @Patch(':id/rol')
  @HttpCode(204)
  async reasignarRol(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    const rol = requireString(asRecord(body).rol, 'rol', 32) as RolAsignable;
    await this.usuarios.reasignarRol(requireUuid(id, 'id'), rol);
  }

  @RequierePermiso('usuario.gestionar')
  @Post(':id/desactivar')
  @HttpCode(204)
  async desactivar(@Param('id') id: string): Promise<void> {
    await this.usuarios.desactivar(requireUuid(id, 'id'));
  }

  @RequierePermiso('usuario.gestionar')
  @Post(':id/reactivar')
  @HttpCode(204)
  async reactivar(@Param('id') id: string): Promise<void> {
    await this.usuarios.reactivar(requireUuid(id, 'id'));
  }

  /** Transferencia de propiedad: el servicio exige que el actor sea `owner`. */
  @RequierePermiso('usuario.gestionar')
  @Post('transferir-propiedad')
  @HttpCode(204)
  async transferirPropiedad(@Body() body: unknown): Promise<void> {
    const membershipId = requireUuid(asRecord(body).membershipId, 'membershipId');
    await this.usuarios.transferirPropiedad(membershipId);
  }

  @RequierePermiso('usuario.gestionar')
  @Patch('segregacion')
  @HttpCode(204)
  async configurarSegregacion(@Body() body: unknown): Promise<void> {
    const datos = asRecord(body);
    const regla = requireString(datos.regla, 'regla', 64);
    if (!(regla in REGLAS_SEGREGACION)) {
      // requireString ya valida no-vacío; acá validamos el dominio cerrado de reglas conocidas.
      throw new BadRequestException(`Regla de segregación desconocida: ${regla}`);
    }
    const activo = optionalBoolean(datos.activo, true);
    await this.segregacion.configurar(regla as ReglaSegregacion, activo);
  }
}
