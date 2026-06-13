import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { DocumentosService } from './documentos.service';
import { EmisionService } from './emision.service';
import { FacturaPdfController } from './pdf/factura-pdf.controller';
import { FacturaPdfService } from './pdf/factura-pdf.service';

/**
 * Módulo de documentos (P6/P8, docs/05 §3.4 y §4): emisión transaccional con numeración consecutiva
 * sin huecos, validación 00071/00102, asiento automático (factura/NC/ND) e inmutabilidad de lo
 * emitido; cálculo en vivo y ciclo de borrador; PDF de factura. `DatabaseService` y `AuditService`
 * llegan por los módulos globales.
 */
@Module({
  controllers: [DocumentosController, FacturaPdfController],
  providers: [EmisionService, DocumentosService, FacturaPdfService],
  exports: [EmisionService, DocumentosService],
})
export class DocumentosModule {}
