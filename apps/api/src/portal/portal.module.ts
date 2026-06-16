import { Module } from '@nestjs/common';
import { ContabilidadModule } from '../contabilidad/contabilidad.module';
import { DelegacionesService } from './delegaciones.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/**
 * Portal del contador (P16, docs/06 M11). Vista tenant-level de la cartera de empresas: panel
 * multi-empresa con estado de cierres, calendario consolidado de obligaciones, checklist masivo de
 * cierre (reusa `CierreMensualService` de Contabilidad) y delegaciones de permisos por empresa.
 * `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  imports: [ContabilidadModule],
  controllers: [PortalController],
  providers: [PortalService, DelegacionesService],
})
export class PortalModule {}
