import { Module } from '@nestjs/common';
import { CobrosController } from './cobros.controller';
import { CobrosService } from './cobros.service';

/**
 * Módulo de cobros (P8, docs/06 M3): registro transaccional del cobro de facturas con split
 * multimoneda, IGTF percibido, diferencial cambiario y vuelto. `DatabaseService` y `AuditService`
 * llegan por los módulos globales.
 */
@Module({
  controllers: [CobrosController],
  providers: [CobrosService],
  exports: [CobrosService],
})
export class CobrosModule {}
