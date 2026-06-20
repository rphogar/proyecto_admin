import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DosFactoresGuard } from './dos-factores.guard';
import { PermisosGuard } from './permisos.guard';
import { PermisosService } from './permisos.service';
import { RateLimitGuard } from './rate-limit.guard';
import { SeguridadController } from './seguridad.controller';
import { SeguridadService } from './seguridad.service';

/**
 * Endurecimiento de seguridad (P18, docs/05 §6): RBAC por acción (`PermisosGuard`), 2FA TOTP
 * (`SeguridadService` + `DosFactoresGuard`) y rate limiting (`RateLimitGuard`).
 *
 * Los tres guards se registran GLOBALMENTE (`APP_GUARD`) y son **opt-in por endpoint**: solo
 * actúan donde hay decorador (`@RequierePermiso`, `@RateLimit`) o donde la política de rol lo
 * exige (2FA). Un endpoint sin decoradores no se ve afectado. Orden: rate limit (barato, antes de
 * tocar la DB) → permisos → 2FA.
 */
@Module({
  controllers: [SeguridadController],
  providers: [
    PermisosService,
    SeguridadService,
    PermisosGuard,
    DosFactoresGuard,
    RateLimitGuard,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermisosGuard },
    { provide: APP_GUARD, useClass: DosFactoresGuard },
  ],
  exports: [PermisosService, SeguridadService],
})
export class SeguridadModule {}
