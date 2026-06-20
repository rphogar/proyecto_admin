import { Body, Controller, Delete, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { requireTenantContext } from '../tenant/tenant-context';
import { PermiteSin2FA } from './dos-factores.guard';
import { asRecord, requireString } from '../maestros/validacion';
import { type EnrolamientoTotp, SeguridadService } from './seguridad.service';
import type { EstadoDosFactores } from './dos-factores';

/**
 * Autoservicio de segundo factor (P18, docs/05 §6). El actor gestiona su PROPIO 2FA: el userId
 * sale del contexto de la petición, nunca del body (no se puede enrolar a otro). Exento del guard
 * de 2FA (`@PermiteSin2FA`): el enrolamiento debe poder completarse aunque el rol aún no cumpla.
 */
@Controller('seguridad/2fa')
@PermiteSin2FA()
export class SeguridadController {
  constructor(private readonly seguridad: SeguridadService) {}

  private actor(): string {
    const ctx = requireTenantContext();
    if (ctx.userId === undefined) {
      throw new UnauthorizedException('Se requiere un usuario autenticado');
    }
    return ctx.userId;
  }

  /** Inicia el enrolamiento: devuelve el secreto/QR para cargar en el autenticador. */
  @Post('iniciar')
  async iniciar(): Promise<EnrolamientoTotp> {
    return this.seguridad.iniciarEnrolamiento(this.actor());
  }

  /** Confirma el enrolamiento con un código del autenticador y activa el 2FA. */
  @Post('confirmar')
  @HttpCode(200)
  async confirmar(@Body() body: unknown): Promise<{ activado: true }> {
    const codigo = requireString(asRecord(body).codigo, 'codigo', 12);
    await this.seguridad.confirmarEnrolamiento(this.actor(), codigo);
    return { activado: true };
  }

  /** Estado del 2FA del actor. */
  @Get('estado')
  async estado(): Promise<EstadoDosFactores> {
    return this.seguridad.estado(this.actor());
  }

  /** Desactiva el 2FA del actor (reemplazo de dispositivo → re-enrolamiento posterior). */
  @Delete()
  @HttpCode(204)
  async desactivar(): Promise<void> {
    await this.seguridad.desactivar(this.actor());
  }
}
