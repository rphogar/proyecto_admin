import { Module } from '@nestjs/common';
import { CumplimientoModule } from '../cumplimiento/cumplimiento.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { ImpresionFiscalController } from './impresion-fiscal.controller';
import { ImpresionFiscalService } from './impresion-fiscal.service';
import { impresoraFiscalSimuladaProvider } from './impresora-fiscal.adapter';

/**
 * Impresora fiscal homologada (P23, docs/02 §6.1, docs/05 §5). Cola de impresión hacia la máquina
 * fiscal con contrato de agente local (reclamar/reportar), emisión por máquina fiscal (la numeración
 * la asigna el hardware), reportes X/Z y memoria fiscal. Importa `DocumentosModule` (EmisionService y
 * DocumentosService) y `CumplimientoModule` (bitácora fiscal). El adapter `ImpresoraFiscal` se inyecta
 * por token (`IMPRESORA_FISCAL`): hoy simulado, mañana proxy al agente con el driver real.
 * `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  imports: [DocumentosModule, CumplimientoModule],
  controllers: [ImpresionFiscalController],
  providers: [ImpresionFiscalService, impresoraFiscalSimuladaProvider],
  exports: [ImpresionFiscalService],
})
export class ImpresionFiscalModule {}
