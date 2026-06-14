import { Module } from '@nestjs/common';
import { DeclaracionesService } from './declaraciones.service';
import { ImpuestosController } from './impuestos.controller';
import { LibrosService } from './libros.service';

/**
 * Módulo de Impuestos (P10, docs/06 M7, docs/02 §7.2/§3.2/§5): genera los Libros de Compras/Ventas
 * (PDF legal + Excel) y las planillas borrador de IVA e IGTF desde la única fuente de verdad
 * (`document_taxes`/`purchase_taxes`/`cobros`), garantizando la triple igualdad libro ≡ documentos ≡
 * planilla, y presenta declaraciones con snapshot inmutable. `DatabaseService` y `AuditService`
 * llegan por los módulos globales.
 */
@Module({
  controllers: [ImpuestosController],
  providers: [LibrosService, DeclaracionesService],
  exports: [LibrosService, DeclaracionesService],
})
export class ImpuestosModule {}
