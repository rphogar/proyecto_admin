import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type Delegacion, DelegacionesService } from './delegaciones.service';
import { type CalendarioDto, type ChecklistMasivoDto, type PanelDto, PortalService } from './portal.service';

/**
 * Portal del contador (P16, docs/06 M11). Vista tenant-level de la cartera de empresas: panel
 * multi-empresa con estado de cierres, calendario consolidado de obligaciones, checklist masivo de
 * cierre y delegaciones de permisos por empresa. Los permisos (`portal.view`/`portal.delegar`, seed
 * en 0052) se cablean con los guards de auth (regla 13); otorgar/revocar es prerrogativa del dueño.
 */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly delegaciones: DelegacionesService,
  ) {}

  // ── Panel multi-empresa ──────────────────────────────────────────────────────
  @Get('panel')
  async panel(): Promise<PanelDto> {
    return this.portal.panel();
  }

  // ── Calendario consolidado de obligaciones ────────────────────────────────────
  @Get('calendario')
  async calendario(): Promise<CalendarioDto> {
    return this.portal.calendario();
  }

  // ── Checklist masivo de cierre ─────────────────────────────────────────────────
  @Get('checklist')
  async checklist(@Query() query: unknown): Promise<ChecklistMasivoDto> {
    return this.portal.checklistMasivo(query);
  }

  // ── Delegaciones de permisos por empresa ───────────────────────────────────────
  @Post('delegaciones')
  async otorgar(@Body() body: unknown): Promise<Delegacion> {
    return this.delegaciones.otorgar(body);
  }

  @Post('delegaciones/revocar')
  async revocar(@Body() body: unknown): Promise<Delegacion> {
    return this.delegaciones.revocar(body);
  }

  @Get('delegaciones')
  async listarDelegaciones(@Query('companyId') companyId?: string): Promise<Delegacion[]> {
    return this.delegaciones.listar(companyId);
  }
}
