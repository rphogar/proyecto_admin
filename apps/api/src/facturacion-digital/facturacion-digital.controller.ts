import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import {
  FacturacionDigitalService,
  type FilaEntregaDigital,
  type ResultadoEmisionDigital,
  type ResumenProcesoDigital,
} from './facturacion-digital.service';

/**
 * Factura digital (P24, Providencia SNAT/2024/000102; docs/05 §5, docs/13). `emitir` corre el ciclo
 * emisión → asignación del número de control digital → entrega electrónica → conservación; `procesar`
 * reintenta las entregas/conservaciones pendientes (contingencia); `cola` es diagnóstico/auditoría. Los
 * permisos `facturacion-digital.*` (seed 0067) los aplica `PermisosGuard` por endpoint (regla 13).
 */
@Controller('facturacion-digital')
export class FacturacionDigitalController {
  constructor(private readonly facturacionDigital: FacturacionDigitalService) {}

  /** Emite una factura digital y dispara su entrega electrónica. */
  @Post('emitir')
  @RequierePermiso('facturacion-digital.emitir')
  async emitir(@Body() body: unknown): Promise<ResultadoEmisionDigital> {
    return this.facturacionDigital.emitirDigital(body);
  }

  /** Reprocesa entregas/conservaciones pendientes de la cola (body opcional: `limite`). */
  @Post('procesar')
  @HttpCode(200)
  @RequierePermiso('facturacion-digital.procesar')
  async procesar(@Body() body: unknown): Promise<ResumenProcesoDigital> {
    const limite = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).limite : undefined;
    return this.facturacionDigital.procesarPendientes(limite);
  }

  /** Diagnóstico de la cola de entregas digitales (filtros opcionales `companyId`, `estado`). */
  @Get('cola')
  @RequierePermiso('facturacion-digital.leer')
  async cola(@Query() query: Record<string, unknown>): Promise<FilaEntregaDigital[]> {
    return this.facturacionDigital.listar(query);
  }
}
