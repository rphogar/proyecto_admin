import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { asRecord, requireString } from '../maestros/validacion';
import { PermiteSin2FA } from '../seguridad/dos-factores.guard';
import { RateLimit } from '../seguridad/rate-limit.guard';
import { AuthService, type OrigenPeticion, type ParSesion, type ResultadoLogin } from './auth.service';

/**
 * Endpoints de autenticación (P27, docs/05 §6). Son PRE-tenant: el `app.module` los excluye del
 * `TenantContextMiddleware` (no llevan `x-tenant-id`). Marcados `@PermiteSin2FA` (el reto 2FA lo
 * gobierna el propio flujo de login) y con `@RateLimit` en los puntos sensibles, más el lockout
 * por cuenta del `AuthService`. El origen (IP/UA) se toma de la petición para `auth_events`.
 *
 * Política de longitud de contraseña: mínimo 8 caracteres (validación de entrada). Las reglas de
 * complejidad/expiración se pueden endurecer luego sin tocar el contrato.
 */
@Controller('auth')
@PermiteSin2FA()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private origen(req: Request): OrigenPeticion {
    return { ip: req.ip ?? undefined, device: req.header('user-agent') ?? undefined };
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
  async login2fa(@Body() body: unknown, @Req() req: Request): Promise<ParSesion> {
    const datos = asRecord(body);
    const reto = requireString(datos.reto, 'reto', 4096);
    const codigo = requireString(datos.codigo, 'codigo', 12);
    return this.auth.login2fa(reto, codigo, this.origen(req));
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
