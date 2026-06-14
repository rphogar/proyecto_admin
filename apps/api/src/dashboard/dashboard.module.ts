import { Module } from '@nestjs/common';
import { TasasModule } from '../tasas/tasas.module';
import { TesoreriaModule } from '../tesoreria/tesoreria.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Dashboard del dueño (P14, docs/06 M0). Agrega en una sola lectura todos los widgets de la vista
 * móvil-primero a partir del ledger y las tablas fuente (sin cifras cacheadas, regla 8). Reusa la
 * `PosicionService` de Tesorería (caja consolidada) y la `TasasService` (tasa del día + frescura);
 * `DatabaseService` llega por el módulo global.
 */
@Module({
  imports: [TesoreriaModule, TasasModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
