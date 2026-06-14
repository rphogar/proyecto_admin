import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type ManualEntryAttachment, type ResultadoAsientoManual, AsientosManualesService } from './asientos-manuales.service';
import { type Cierre, type EvaluacionCierre, type Period as PeriodCierre, CierreMensualService } from './cierre-mensual.service';
import { type Period, PeriodosService } from './periodos.service';
import { type PostingTemplate, type PostingTemplateVersion, PlantillasService } from './plantillas.service';
import {
  type BalanceComprobacionDTO,
  type EstadoResultadosDTO,
  type EstadoSituacionDTO,
  type MovimientoFuente,
  ReportesService,
} from './reportes.service';
import type { ResultadoCuadre } from '@contave/ledger';

/**
 * Contabilidad y cierre (P13, docs/06 M6). Vista del contador: períodos, asientos manuales (con
 * soportes), plantillas de contabilización versionadas, balance de comprobación y estados
 * financieros en doble base con drill-down, y el wizard de cierre mensual (evaluar/cerrar/reabrir).
 * Los permisos (`contabilidad.*`, seed en 0044) se cablean con los guards de auth (regla 13); la
 * reapertura valida el rol en servicio (caso 43).
 */
@Controller('contabilidad')
export class ContabilidadController {
  constructor(
    private readonly periodos: PeriodosService,
    private readonly asientos: AsientosManualesService,
    private readonly plantillas: PlantillasService,
    private readonly reportes: ReportesService,
    private readonly cierre: CierreMensualService,
  ) {}

  // ── Períodos ───────────────────────────────────────────────────────────────
  @Post('periodos')
  async crearPeriodo(@Body() body: unknown): Promise<Period> {
    return this.periodos.crear(body);
  }

  @Get('periodos')
  async listarPeriodos(@Query('companyId') companyId: string): Promise<Period[]> {
    return this.periodos.listar(companyId);
  }

  // ── Asientos manuales ────────────────────────────────────────────────────────
  @Post('asientos/validar')
  async validarAsiento(@Body() body: unknown): Promise<ResultadoCuadre> {
    return this.asientos.validar(body);
  }

  @Post('asientos')
  async crearAsiento(@Body() body: unknown): Promise<ResultadoAsientoManual> {
    return this.asientos.crear(body);
  }

  @Post('asientos/adjuntar')
  async adjuntarSoporte(@Body() body: unknown): Promise<ManualEntryAttachment> {
    return this.asientos.adjuntar(body);
  }

  // ── Plantillas de contabilización ────────────────────────────────────────────
  @Post('plantillas')
  async crearPlantilla(@Body() body: unknown): Promise<{ template: PostingTemplate; version: PostingTemplateVersion }> {
    return this.plantillas.crear(body);
  }

  @Post('plantillas/editar')
  async editarPlantilla(@Body() body: unknown): Promise<PostingTemplateVersion> {
    return this.plantillas.editar(body);
  }

  @Get('plantillas')
  async listarPlantillas(@Query('companyId') companyId: string): Promise<PostingTemplate[]> {
    return this.plantillas.listar(companyId);
  }

  // ── Reportes ──────────────────────────────────────────────────────────────
  @Get('balance-comprobacion')
  async balanceComprobacion(@Query() query: unknown): Promise<BalanceComprobacionDTO> {
    return this.reportes.balanceComprobacion(query);
  }

  @Get('estado-resultados')
  async estadoResultados(@Query() query: unknown): Promise<EstadoResultadosDTO> {
    return this.reportes.estadoResultados(query);
  }

  @Get('estado-situacion')
  async estadoSituacion(@Query() query: unknown): Promise<EstadoSituacionDTO> {
    return this.reportes.estadoSituacion(query);
  }

  @Get('drill-down')
  async drillDown(@Query() query: unknown): Promise<MovimientoFuente[]> {
    return this.reportes.drillDown(query);
  }

  // ── Cierre mensual (wizard) ──────────────────────────────────────────────────
  @Get('cierre/evaluar')
  async evaluarCierre(@Query() query: unknown): Promise<EvaluacionCierre> {
    return this.cierre.evaluar(query);
  }

  @Post('cierre/cerrar')
  async cerrar(@Body() body: unknown): Promise<{ cierre: Cierre; period: PeriodCierre }> {
    return this.cierre.cerrar(body);
  }

  @Post('cierre/reabrir')
  async reabrir(@Body() body: unknown): Promise<{ cierre: Cierre; period: PeriodCierre }> {
    return this.cierre.reabrir(body);
  }
}
