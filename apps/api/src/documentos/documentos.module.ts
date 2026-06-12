import { Module } from '@nestjs/common';
import { DocumentosController } from './documentos.controller';
import { EmisionService } from './emision.service';

/**
 * Módulo de documentos (P6, docs/05 §3.4 y §4): emisión transaccional de facturas con numeración
 * consecutiva sin huecos, validación de requisitos (00071/00102), asiento automático e
 * inmutabilidad de lo emitido. `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  controllers: [DocumentosController],
  providers: [EmisionService],
  exports: [EmisionService],
})
export class DocumentosModule {}
