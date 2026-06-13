import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';
import { RetencionComprobantePdfController } from './pdf/comprobante-pdf.controller';
import { RetencionComprobantePdfService } from './pdf/comprobante-pdf.service';
import { RetencionesRecibidasService } from './retenciones-recibidas.service';

/**
 * Módulo de compras y retenciones (P9, docs/06 M2, docs/02 §3.3/§4): registro transaccional de
 * facturas de compra con retención de IVA (75/100) e ISLR por concepto como agente —comprobantes
 * con numeración AAAAMMNNNNNNNN y TXT del portal SENIAT—, y registro de comprobantes recibidos con
 * imputación por período. `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  controllers: [ComprasController, RetencionComprobantePdfController],
  providers: [ComprasService, RetencionesRecibidasService, RetencionComprobantePdfService],
  exports: [ComprasService, RetencionesRecibidasService],
})
export class ComprasModule {}
