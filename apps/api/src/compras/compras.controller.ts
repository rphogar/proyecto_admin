import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type CompraRegistrada, ComprasService } from './compras.service';
import { type RetencionRecibidaRegistrada, RetencionesRecibidasService } from './retenciones-recibidas.service';
import { type purchases, type retentionsReceived } from '../db/schema';

/**
 * Compras y retenciones (P9, docs/06 M2). Registro de facturas de compra con retención de IVA/ISLR
 * en el mismo flujo, y registro de comprobantes de retención recibidos. Los permisos
 * (`compra.create`, `retencion.issue`, `retencion.receive`, `*.view`) se cablean con los guards de
 * auth (regla 13; seed en 0028).
 */
@Controller('compras')
export class ComprasController {
  constructor(
    private readonly compras: ComprasService,
    private readonly recibidas: RetencionesRecibidasService,
  ) {}

  /** Registra una factura de compra (genera asiento, crédito fiscal y comprobantes de retención). */
  @Post()
  async registrar(@Body() body: unknown): Promise<CompraRegistrada> {
    return this.compras.registrar(body);
  }

  /** Lista compras de la empresa. */
  @Get()
  async listar(@Query('companyId') companyId: string): Promise<(typeof purchases.$inferSelect)[]> {
    return this.compras.listar(companyId);
  }

  /** Registra un comprobante de retención recibido (imputación por período de recepción). */
  @Post('retenciones-recibidas')
  async registrarRecibida(@Body() body: unknown): Promise<RetencionRecibidaRegistrada> {
    return this.recibidas.registrar(body);
  }

  /** Lista comprobantes de retención recibidos de la empresa. */
  @Get('retenciones-recibidas')
  async listarRecibidas(@Query('companyId') companyId: string): Promise<(typeof retentionsReceived.$inferSelect)[]> {
    return this.recibidas.listar(companyId);
  }
}
