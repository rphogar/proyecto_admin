import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { asRecord, requireString, requireUuid } from '../maestros/validacion';
import { PermiteSin2FA } from '../seguridad/dos-factores.guard';
import { claveJwt, verificarJwt } from '../seguridad/jwt';
import { type MembresiaEmpresa, PermisosService } from '../seguridad/permisos.service';
import { RateLimit } from '../seguridad/rate-limit.guard';
import {
  AuthService,
  type OrigenPeticion,
  type ParSesion,
  type ResultadoLogin,
  type SesionEmitida,
} from './auth.service';

/**
 * Endpoints de autenticación (P27/P28, docs/05 §6). El `app.module` los excluye del
 * `TenantContextMiddleware`: el login/refresh/recuperación son PRE-tenant y `cambiar-empresa`
 * cambia el tenant del token, así que el actor se resuelve del `Authorization: Bearer` a mano
 * (`actorDesdeBearer`). Marcados `@PermiteSin2FA` (el reto 2FA lo gobierna el propio flujo de
 * login) y con `@RateLimit` en los puntos sensibles, más el lockout por cuenta del `AuthService`.
 * El origen (IP/UA) se toma de la petición para `auth_events`.
 *
 * Política de longitud de contraseña: mínimo 8 caracteres (validación de entrada). Las reglas de
 * complejidad/expiración se pueden endurecer luego sin tocar el contrato.
 */
@Controller('auth')
@PermiteSin2FA()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly permisos: PermisosService,
  ) {}

  private origen(req: Request): OrigenPeticion {
    return { ip: req.ip ?? undefined, device: req.header('user-agent') ?? undefined };
  }

  /**
   * Resuelve el `userId` desde el access JWT del `Authorization: Bearer` (P28). Las rutas `/auth/*`
   * van EXCLUIDAS del middleware de tenant a propósito: `cambiar-empresa` cambia el tenant del
   * token, así que no puede depender de un contexto ya atado a un tenant; verifica el token a mano.
   */
  private actorDesdeBearer(req: Request): string {
    const cabecera = req.header('authorization') ?? '';
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice('Bearer '.length).trim() : '';
    const claims = token === '' ? null : verificarJwt(token, claveJwt());
    if (claims === null || claims.scope !== 'access') {
      throw new UnauthorizedException({ codigo: 'TOKEN_INVALIDO', message: 'Sesión inválida o expirada' });
    }
    return claims.sub;
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit({ nombre: 'auth-login', limite: 10, ventanaMs: 60_000 })
  async login(@Body() body: unknown, @Req() req: Request): Promise<ResultadoLogin> {
    const datos = asRecord(body);
    const email = requireString(datos.email, 'email', 320);
    const password = requireString(datos.password, 'password', 200);
    return this.auth.login(email, password, this.origen(req));
  }

  @Post('login/2fa')
  @HttpCode(200)
  @RateLimit({ nombre: 'auth-2fa', limite: 10, ventanaMs: 60_000 })
  async login2fa(@Body() body: unknown, @Req() req: Request): Promise<SesionEmitida> {
    const datos = asRecord(body);
    const reto = requireString(datos.reto, 'reto', 4096);
    const codigo = requireString(datos.codigo, 'codigo', 12);
    return this.auth.login2fa(reto, codigo, this.origen(req));
  }

  /** Empresas del usuario autenticado (selector de empresa, P28). Actor desde el Bearer. */
  @Get('empresas')
  async empresas(@Req() req: Request): Promise<MembresiaEmpresa[]> {
    return this.permisos.membresiasDe(this.actorDesdeBearer(req));
  }

  /**
   * Cambia la empresa/tenant activa: valida la membresía y re-emite una sesión acotada (P28).
   * 403 `SIN_MEMBRESIA` si el usuario no pertenece a la empresa destino.
   */
  @Post('cambiar-empresa')
  @HttpCode(200)
  @RateLimit({ nombre: 'auth-cambiar-empresa', limite: 20, ventanaMs: 60_000 })
  async cambiarEmpresa(@Body() body: unknown, @Req() req: Request): Promise<SesionEmitida> {
    const tenantId = requireUuid(asRecord(body).tenantId, 'tenantId');
    return this.auth.cambiarEmpresa(this.actorDesdeBearer(req), tenantId, this.origen(req));
  }

  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ nombre: 'auth-refresh', limite: 30, ventanaMs: 60_000 })
  async refresh(@Body() body: unknown, @Req() req: Request): Promise<ParSesion> {
    const refreshToken = requireString(asRecord(body).refreshToken, 'refreshToken', 4096);
    return this.auth.refrescar(refreshToken, this.origen(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const refreshToken = requireString(asRecord(body).refreshToken, 'refreshToken', 4096);
    await this.auth.logout(refreshToken, this.origen(req));
  }

  @Post('recuperacion/solicitar')
  @HttpCode(202)
  @RateLimit({ nombre: 'auth-reset', limite: 5, ventanaMs: 60_000 })
  async solicitarRecuperacion(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ tokenDev?: string }> {
    const email = requireString(asRecord(body).email, 'email', 320);
    return this.auth.solicitarRecuperacion(email, this.origen(req));
  }

  @Post('recuperacion/confirmar')
  @HttpCode(204)
  @RateLimit({ nombre: 'auth-reset', limite: 5, ventanaMs: 60_000 })
  async confirmarRecuperacion(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const datos = asRecord(body);
    const token = requireString(datos.token, 'token', 4096);
    const nuevaPassword = requireString(datos.nuevaPassword, 'nuevaPassword', 200);
    if (nuevaPassword.length < 8) {
      throw new BadRequestException('nuevaPassword debe tener al menos 8 caracteres');
    }
    await this.auth.confirmarRecuperacion(token, nuevaPassword, this.origen(req));
  }
}
