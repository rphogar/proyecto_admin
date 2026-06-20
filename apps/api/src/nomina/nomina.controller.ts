import { Body, Controller, Get, Header, Post, Query, StreamableFile } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import { type Ari, type Arc, AriArcService } from './ari-arc.service';
import { type Concepto, ConceptosService } from './conceptos.service';
import { type Corrida, type CorridaConRecibos, CorridasService } from './corridas.service';
import { type Parafiscal, ParafiscalesService } from './parafiscales.service';
import { type MovimientoKardex, type ResultadoLiquidacion, PrestacionesService } from './prestaciones.service';
import { type Provision, type ResultadoProvisiones, ProvisionesService } from './provisiones.service';
import { RecibosPdfService } from './recibos-pdf.service';
import { type Trabajador, TrabajadoresService } from './trabajadores.service';

/**
 * Nómina (P15, docs/04, docs/06 M8). Vista del contador: fichas, conceptos con fórmulas seguras,
 * corridas (pre-nómina→aprobación→contabilización), recibos PDF, kardex de prestaciones y
 * liquidación (art. 142), provisiones mensuales, parafiscales con planillas y ARI/ARC. Los permisos
 * (`nomina.*`/`payroll.*`/`salary.read`, seed en 0048/0004) se cablean con los guards (regla 13).
 */
@Controller('nomina')
export class NominaController {
  constructor(
    private readonly trabajadores: TrabajadoresService,
    private readonly conceptos: ConceptosService,
    private readonly corridas: CorridasService,
    private readonly prestaciones: PrestacionesService,
    private readonly provisiones: ProvisionesService,
    private readonly parafiscales: ParafiscalesService,
    private readonly ariArc: AriArcService,
    private readonly recibosPdf: RecibosPdfService,
  ) {}

  // ── Trabajadores ──────────────────────────────────────────────────────────
  @Post('trabajadores')
  crearTrabajador(@Body() body: unknown): Promise<Trabajador> {
    return this.trabajadores.crear(body);
  }

  @Post('trabajadores/actualizar')
  actualizarTrabajador(@Body() body: unknown): Promise<Trabajador> {
    return this.trabajadores.actualizar(body);
  }

  @Get('trabajadores')
  @RequierePermiso('salary.read')
  listarTrabajadores(@Query('companyId') companyId: string): Promise<Trabajador[]> {
    return this.trabajadores.listar(companyId);
  }

  // ── Conceptos ─────────────────────────────────────────────────────────────
  @Post('conceptos/validar')
  validarConcepto(@Body() body: unknown): { valida: boolean; errores: string[] } {
    return this.conceptos.validar(body);
  }

  @Post('conceptos')
  crearConcepto(@Body() body: unknown): Promise<Concepto> {
    return this.conceptos.crear(body);
  }

  @Post('conceptos/actualizar')
  actualizarConcepto(@Body() body: unknown): Promise<Concepto> {
    return this.conceptos.actualizar(body);
  }

  @Get('conceptos')
  listarConceptos(@Query('companyId') companyId: string): Promise<Concepto[]> {
    return this.conceptos.listar(companyId);
  }

  // ── Corridas ──────────────────────────────────────────────────────────────
  @Post('corridas')
  @RequierePermiso('payroll.create')
  crearCorrida(@Body() body: unknown): Promise<CorridaConRecibos> {
    return this.corridas.crear(body);
  }

  @Post('corridas/aprobar')
  @RequierePermiso('payroll.approve')
  aprobarCorrida(@Body() body: unknown): Promise<Corrida> {
    return this.corridas.aprobar(body);
  }

  @Post('corridas/contabilizar')
  contabilizarCorrida(@Body() body: unknown): Promise<Corrida> {
    return this.corridas.contabilizar(body);
  }

  @Get('corridas')
  listarCorridas(@Query('companyId') companyId: string): Promise<Corrida[]> {
    return this.corridas.listar(companyId);
  }

  @Get('corridas/detalle')
  @RequierePermiso('salary.read')
  detalleCorrida(@Query('companyId') companyId: string, @Query('id') id: string): Promise<CorridaConRecibos> {
    return this.corridas.obtener(id, companyId);
  }

  // ── Recibo PDF ──────────────────────────────────────────────────────────────
  @Get('recibos/pdf')
  @RequierePermiso('salary.read')
  @Header('Content-Type', 'application/pdf')
  async reciboPdf(@Query('companyId') companyId: string, @Query('id') id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.recibosPdf.generar(companyId, id);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${filename}"` });
  }

  // ── Prestaciones ──────────────────────────────────────────────────────────
  @Post('prestaciones/movimiento')
  registrarMovimiento(@Body() body: unknown): Promise<MovimientoKardex> {
    return this.prestaciones.registrar(body);
  }

  @Get('prestaciones/kardex')
  @RequierePermiso('salary.read')
  kardex(@Query('companyId') companyId: string, @Query('trabajadorId') trabajadorId: string): Promise<MovimientoKardex[]> {
    return this.prestaciones.kardex(companyId, trabajadorId);
  }

  @Post('prestaciones/liquidar')
  liquidar(@Body() body: unknown): Promise<ResultadoLiquidacion> {
    return this.prestaciones.liquidar(body);
  }

  // ── Provisiones ─────────────────────────────────────────────────────────────
  @Post('provisiones')
  generarProvisiones(@Body() body: unknown): Promise<ResultadoProvisiones> {
    return this.provisiones.generar(body);
  }

  @Get('provisiones')
  listarProvisiones(@Query('companyId') companyId: string, @Query('anio') anio: string, @Query('mes') mes: string): Promise<Provision[]> {
    return this.provisiones.listar(companyId, Number(anio), Number(mes));
  }

  // ── Parafiscales ────────────────────────────────────────────────────────────
  @Post('parafiscales/calcular')
  calcularParafiscales(@Body() body: unknown): Promise<Parafiscal[]> {
    return this.parafiscales.calcular(body);
  }

  @Get('parafiscales')
  listarParafiscales(@Query('companyId') companyId: string, @Query('anio') anio: string, @Query('mes') mes: string): Promise<Parafiscal[]> {
    return this.parafiscales.listar(companyId, Number(anio), Number(mes));
  }

  @Post('parafiscales/planilla')
  async generarPlanilla(@Body() body: unknown): Promise<StreamableFile> {
    const archivo = await this.parafiscales.generarPlanilla(body);
    return new StreamableFile(Buffer.from(archivo.contenido, 'utf8'), {
      type: archivo.contentType,
      disposition: `attachment; filename="${archivo.filename}"`,
    });
  }

  // ── ARI / ARC ─────────────────────────────────────────────────────────────
  @Post('ari')
  setAri(@Body() body: unknown): Promise<Ari> {
    return this.ariArc.setAri(body);
  }

  @Get('ari')
  listarAri(@Query('companyId') companyId: string, @Query('trabajadorId') trabajadorId: string): Promise<Ari[]> {
    return this.ariArc.listarAri(companyId, trabajadorId);
  }

  @Post('arc')
  emitirArc(@Body() body: unknown): Promise<Arc> {
    return this.ariArc.emitirArc(body);
  }

  @Get('arc')
  listarArc(@Query('companyId') companyId: string, @Query('ejercicio') ejercicio: string): Promise<Arc[]> {
    return this.ariArc.listarArc(companyId, Number(ejercicio));
  }
}
