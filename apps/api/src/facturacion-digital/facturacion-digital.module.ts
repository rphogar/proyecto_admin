import { Module } from '@nestjs/common';
import { CumplimientoModule } from '../cumplimiento/cumplimiento.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { FacturacionDigitalController } from './facturacion-digital.controller';
import { FacturacionDigitalService } from './facturacion-digital.service';
import { imprentaDigitalSimuladaProvider } from './imprenta-digital.adapter';

/**
 * Factura digital (P24, Providencia SNAT/2024/000102; docs/05 §5, docs/13). Régimen de emisión digital:
 * asignación del número de control digital por la imprenta autorizada, entrega electrónica y
 * conservación, con cola de reintentos. Importa `DocumentosModule` (EmisionService y DocumentosService)
 * y `CumplimientoModule` (bitácora fiscal). El adapter `ImprentaDigital` se inyecta por token
 * (`IMPRENTA_DIGITAL`): hoy simulado, mañana el proveedor autorizado. `DatabaseService` y `AuditService`
 * llegan por los módulos globales.
 */
@Module({
  imports: [DocumentosModule, CumplimientoModule],
  controllers: [FacturacionDigitalController],
  providers: [FacturacionDigitalService, imprentaDigitalSimuladaProvider],
  exports: [FacturacionDigitalService],
})
export class FacturacionDigitalModule {}
