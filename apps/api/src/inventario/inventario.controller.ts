import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type AjusteConLineas, type Ajuste, AjustesService } from './ajustes.service';
import { AlertasService } from './alertas.service';
import { type Conteo, type ConteoConLineas, ConteosService } from './conteos.service';
import { MovimientosService } from './movimientos.service';
import { PreciosService } from './precios.service';
import { type Traslado, type TrasladoConLineas, TrasladosService } from './traslados.service';
import { type ResultadoMargen } from './calculo-margen';
import { type ResultadoPrecios } from './calculo-precios';
import { type StockMove } from './kardex-core';

/**
 * Inventario (P12, docs/06 M5): kardex y costo promedio en doble base, entradas/ventas con asiento,
 * ajustes con aprobación, traslados con tránsito, conteos físicos, precios masivos y alerta de margen
 * negativo en USD. Los permisos (`inventario.*`, seed en 0040) se cablean con los guards de auth
 * (regla 13).
 */
@Controller('inventario')
export class InventarioController {
  constructor(
    private readonly movimientos: MovimientosService,
    private readonly ajustes: AjustesService,
    private readonly traslados: TrasladosService,
    private readonly conteos: ConteosService,
    private readonly precios: PreciosService,
    private readonly alertas: AlertasService,
  ) {}

  // ── Movimientos, kardex y existencias ──────────────────────────────────────
  @Post('entrada')
  async entrada(@Body() body: unknown): Promise<StockMove> {
    return this.movimientos.entrada(body);
  }

  @Post('venta')
  async venta(@Body() body: unknown): Promise<StockMove> {
    return this.movimientos.venta(body);
  }

  @Get('kardex')
  async kardex(
    @Query('companyId') companyId: string,
    @Query('itemId') itemId: string,
  ): Promise<{ movimientos: StockMove[]; costo: unknown }> {
    return this.movimientos.kardex(companyId, itemId);
  }

  @Get('existencia')
  async existencia(
    @Query('companyId') companyId: string,
    @Query('itemId') itemId: string,
    @Query('warehouseId') warehouseId: string,
  ): Promise<{ cantidad: string; valorVes: string; valorUsd: string }> {
    return this.movimientos.existencia(companyId, itemId, warehouseId);
  }

  // ── Ajustes (con aprobación) ───────────────────────────────────────────────
  @Post('ajustes')
  async crearAjuste(@Body() body: unknown): Promise<AjusteConLineas> {
    return this.ajustes.crear(body);
  }

  @Post('ajustes/aprobar')
  async aprobarAjuste(@Body() body: unknown): Promise<AjusteConLineas> {
    return this.ajustes.aprobar(body);
  }

  @Post('ajustes/rechazar')
  async rechazarAjuste(@Body() body: unknown): Promise<Ajuste> {
    return this.ajustes.rechazar(body);
  }

  @Get('ajustes')
  async listarAjustes(@Query('companyId') companyId: string): Promise<Ajuste[]> {
    return this.ajustes.listar(companyId);
  }

  // ── Traslados (con tránsito) ───────────────────────────────────────────────
  @Post('traslados/despachar')
  async despachar(@Body() body: unknown): Promise<TrasladoConLineas> {
    return this.traslados.despachar(body);
  }

  @Post('traslados/recibir')
  async recibir(@Body() body: unknown): Promise<TrasladoConLineas> {
    return this.traslados.recibir(body);
  }

  @Get('traslados')
  async listarTraslados(@Query('companyId') companyId: string): Promise<Traslado[]> {
    return this.traslados.listar(companyId);
  }

  // ── Conteo físico ──────────────────────────────────────────────────────────
  @Post('conteos/abrir')
  async abrirConteo(@Body() body: unknown): Promise<ConteoConLineas> {
    return this.conteos.abrir(body);
  }

  @Post('conteos/capturar')
  async capturarConteo(@Body() body: unknown): Promise<ConteoConLineas> {
    return this.conteos.capturar(body);
  }

  @Post('conteos/cerrar')
  async cerrarConteo(@Body() body: unknown): Promise<{ conteo: Conteo; ajusteId: string | null }> {
    return this.conteos.cerrar(body);
  }

  @Get('conteos')
  async listarConteos(@Query('companyId') companyId: string): Promise<Conteo[]> {
    return this.conteos.listar(companyId);
  }

  // ── Precios masivos ────────────────────────────────────────────────────────
  @Post('precios/preview')
  async previewPrecios(@Body() body: unknown): Promise<ResultadoPrecios> {
    return this.precios.preview(body);
  }

  @Post('precios/aplicar')
  async aplicarPrecios(
    @Body() body: unknown,
  ): Promise<{ actualizados: number; resultado: ResultadoPrecios }> {
    return this.precios.aplicar(body);
  }

  // ── Alertas ────────────────────────────────────────────────────────────────
  @Get('alertas/margen')
  async margenNegativo(
    @Query('companyId') companyId: string,
    @Query('rateBcv') rateBcv: string,
    @Query('priceListId') priceListId?: string,
  ): Promise<ResultadoMargen> {
    return this.alertas.margenNegativo(companyId, rateBcv, priceListId);
  }
}
