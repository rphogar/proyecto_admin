import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import {
  type EstadoOnboarding,
  type ResultadoApertura,
  type ResultadoCrearEmpresa,
  type ResultadoInferencia,
  OnboardingService,
} from './onboarding.service';

/**
 * Asistente de alta de empresa (P30, docs/06 flujo #5, M12). Tres pasos: inferir el perfil (preview),
 * crear la empresa con su precarga, y registrar los saldos iniciales (asiento de apertura). Pasa por
 * `TenantContextMiddleware` (tenant del JWT). Las escrituras exigen `empresa.crear` (regla 13); la
 * lectura del estado, `empresa.ver`.
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Post('inferir-perfil')
  @RequierePermiso('empresa.crear')
  inferirPerfil(@Body() body: unknown): ResultadoInferencia {
    return this.onboarding.inferir(body);
  }

  @Post('empresas')
  @RequierePermiso('empresa.crear')
  async crearEmpresa(@Body() body: unknown): Promise<ResultadoCrearEmpresa> {
    return this.onboarding.crearEmpresa(body);
  }

  @Post('empresas/:id/saldos-iniciales')
  @RequierePermiso('empresa.crear')
  async saldosIniciales(@Param('id') id: string, @Body() body: unknown): Promise<ResultadoApertura> {
    return this.onboarding.registrarSaldosIniciales({ ...(body as Record<string, unknown>), companyId: id });
  }

  @Get('empresas/:id/estado')
  @RequierePermiso('empresa.ver')
  async estado(@Param('id') id: string): Promise<EstadoOnboarding> {
    return this.onboarding.estado(id);
  }
}
