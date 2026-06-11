import { Module } from '@nestjs/common';
import { CapturaBcvService } from './captura-bcv.service';
import { FUENTE_FALLBACK, FUENTE_PRIMARIA } from './fuentes/fuente-bcv';
import { FuenteBcvFallback } from './fuentes/fuente-bcv-fallback';
import { FuenteBcvPrimaria } from './fuentes/fuente-bcv-primaria';
import { TasasController } from './tasas.controller';
import { TasasScheduler } from './tasas.scheduler';
import { TasasService } from './tasas.service';

/**
 * Módulo de tasas de cambio (P4): resolución/entrada manual (`TasasService`), captura BCV
 * idempotente (`CapturaBcvService` + fuentes primaria/fallback) y su programación (`TasasScheduler`).
 * `DatabaseService` y `AuditService` llegan por los módulos globales (DatabaseModule, AuditModule).
 */
@Module({
  controllers: [TasasController],
  providers: [
    TasasService,
    CapturaBcvService,
    TasasScheduler,
    { provide: FUENTE_PRIMARIA, useClass: FuenteBcvPrimaria },
    { provide: FUENTE_FALLBACK, useClass: FuenteBcvFallback },
  ],
  exports: [TasasService],
})
export class TasasModule {}
