import { Module } from '@nestjs/common';
import { CumplimientoController } from './cumplimiento.controller';
import { ExpedienteService } from './expediente.service';
import { FiscalEventLogService } from './fiscal-event-log.service';
import { REMISION_ADAPTER, StubRemisionAdapter } from './remision-adapter';
import { RemisionService } from './remision.service';

/**
 * Cumplimiento Providencia SNAT/2024/000121 (P17, docs/02 §6.3, docs/05 §3.9): bitácora fiscal
 * integral encadenada (FiscalEventLogService), cola de remisión al SENIAT desacoplada con reintentos
 * y acuse (RemisionService + adapter stub), expediente técnico de homologación (ExpedienteService) e
 * informe de cumplimiento. Exporta los servicios que `DocumentosModule` usa al emitir (registrar el
 * evento de emisión y encolar la remisión en la misma transacción). El adapter de remisión se inyecta
 * por token (`REMISION_ADAPTER`) para sustituirlo por el real cuando el SENIAT publique el canal.
 * `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  controllers: [CumplimientoController],
  providers: [
    FiscalEventLogService,
    RemisionService,
    ExpedienteService,
    { provide: REMISION_ADAPTER, useClass: StubRemisionAdapter },
  ],
  exports: [FiscalEventLogService, RemisionService],
})
export class CumplimientoModule {}
