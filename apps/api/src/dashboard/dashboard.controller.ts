import { Controller, Get, Query } from '@nestjs/common';
import { type DashboardDto, DashboardService } from './dashboard.service';

/**
 * Dashboard del dueño (P14, docs/06 M0). Una sola lectura (`GET /dashboard`) sirve toda la vista
 * móvil-primero: caja, ventas comparadas, utilidad, CxC/CxP, tasa BCV, semáforo fiscal, top
 * productos y alertas — todo derivado en vivo del ledger (regla 8). Permiso de lectura del dueño/
 * gerencia (`dashboard.read`) cuando se cableen los guards de auth (regla 13).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  async resumen(@Query('companyId') companyId: string): Promise<DashboardDto> {
    return this.dashboard.resumen(companyId);
  }
}
