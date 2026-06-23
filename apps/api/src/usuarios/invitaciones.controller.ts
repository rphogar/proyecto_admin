import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { asRecord, optionalString, requireString } from '../maestros/validacion';
import { PermiteSin2FA } from '../seguridad/dos-factores.guard';
import { RateLimit } from '../seguridad/rate-limit.guard';
import { type OrigenPeticion, UsuariosService } from './usuarios.service';

/**
 * Aceptación de invitaciones (P29). PRE-tenant: el invitado todavía no pertenece al tenant, así que
 * estas rutas van EXCLUIDAS del `TenantContextMiddleware` (ver `app.module`) y resuelven todo por el
 * token. Marcadas `@PermiteSin2FA` (no hay sesión aún) y con `@RateLimit` por ser de cara pública.
 * El origen (IP/UA) se toma para auditar la aceptación.
 */
@Controller('invitaciones')
@PermiteSin2FA()
export class InvitacionesController {
  constructor(private readonly usuarios: UsuariosService) {}

  private origen(req: Request): OrigenPeticion {
    return { ip: req.ip ?? undefined, device: req.header('user-agent') ?? undefined };
  }

  /** Datos públicos de la invitación para la pantalla de aceptación (empresa, email, rol). */
  @Get(':token')
  @RateLimit({ nombre: 'invitacion-peek', limite: 20, ventanaMs: 60_000 })
  async peek(
    @Param('token') token: string,
  ): Promise<{ email: string; rol: string; empresa: string; requiereRegistro: boolean }> {
    return this.usuarios.peekInvitacion(requireString(token, 'token', 4096));
  }

  /** Acepta la invitación: crea/vincula el usuario y abre la membresía activa. */
  @Post('aceptar')
  @HttpCode(200)
  @RateLimit({ nombre: 'invitacion-aceptar', limite: 10, ventanaMs: 60_000 })
  async aceptar(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ tenantId: string; rol: string }> {
    const datos = asRecord(body);
    const token = requireString(datos.token, 'token', 4096);
    const nombre = optionalString(datos.nombre, 'nombre', 200) ?? undefined;
    const password = optionalString(datos.password, 'password', 200) ?? undefined;
    return this.usuarios.aceptarInvitacion(token, { nombre, password }, this.origen(req));
  }
}
