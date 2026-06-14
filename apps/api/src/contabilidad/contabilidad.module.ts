import { Module } from '@nestjs/common';
import { TesoreriaModule } from '../tesoreria/tesoreria.module';
import { AsientosManualesService } from './asientos-manuales.service';
import { CierreMensualService } from './cierre-mensual.service';
import { ContabilidadController } from './contabilidad.controller';
import { PeriodosService } from './periodos.service';
import { PlantillasService } from './plantillas.service';
import { ReportesService } from './reportes.service';

/**
 * Módulo de Contabilidad y cierre (P13, docs/06 M6): gestión de períodos, asientos manuales (con
 * soportes), plantillas de contabilización versionadas (aditivas), balance de comprobación y estados
 * financieros en doble base con drill-down, y el wizard de cierre mensual. Importa `TesoreriaModule`
 * para reusar `RevaluacionService` (diferencial NO realizado idempotente, paso 4 del wizard).
 * `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  imports: [TesoreriaModule],
  controllers: [ContabilidadController],
  providers: [PeriodosService, AsientosManualesService, PlantillasService, ReportesService, CierreMensualService],
  exports: [PeriodosService, CierreMensualService],
})
export class ContabilidadModule {}
