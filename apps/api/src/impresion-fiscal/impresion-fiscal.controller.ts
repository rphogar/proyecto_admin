import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import {
  type FilaPrintJob,
  ImpresionFiscalService,
  type ResultadoImpresionDirecta,
  type TrabajoReclamado,
} from './impresion-fiscal.service';

/**
 * Impresora fiscal (P23, docs/05 §5). Contrato del **agente local**: `reclamar` trabajos pendientes y
 * `reportar` su desenlace; más reportes X/Z y lectura de memoria fiscal, y el diagnóstico de la cola.
 * La emisión por máquina fiscal se solicita con `/solicitar` (encola sin cerrar la venta) o, en
 * despliegues sin agente/CI, `/imprimir-directo` (cierra el ciclo con el adapter en proceso). Los
 * permisos `impresion.*` (seed 0063) los aplica `PermisosGuard` por endpoint (regla 13).
 */
@Controller('impresion')
export class ImpresionFiscalController {
  constructor(private readonly impresion: ImpresionFiscalService) {}

  /** Encola un documento para impresión en la máquina fiscal (no consume serie ni cierra la venta). */
  @Post('solicitar')
  @RequierePermiso('impresion.reclamar')
  async solicitar(@Body() body: unknown): Promise<FilaPrintJob> {
    return this.impresion.solicitarImpresion(body);
  }

  /** Cierra el ciclo en proceso con el adapter (CI / despliegue sin agente). */
  @Post('imprimir-directo')
  @RequierePermiso('impresion.reclamar')
  async imprimirDirecto(@Body() body: unknown): Promise<ResultadoImpresionDirecta> {
    return this.impresion.imprimirDirecto(body);
  }

  /** El agente local reclama trabajos pendientes (body: `agenteId`, `limite?`). */
  @Post('reclamar')
  @HttpCode(200)
  @RequierePermiso('impresion.reclamar')
  async reclamar(@Body() body: unknown): Promise<TrabajoReclamado[]> {
    return this.impresion.reclamar(body);
  }

  /** El agente local reporta el desenlace de un trabajo (IMPRESO | REINTENTABLE | PERMANENTE). */
  @Post('reportar')
  @RequierePermiso('impresion.reportar')
  async reportar(@Body() body: unknown): Promise<FilaPrintJob> {
    return this.impresion.reportarResultado(body);
  }

  /** Reporte X (corte parcial). */
  @Post('reporte-x')
  @HttpCode(200)
  @RequierePermiso('impresion.reporte')
  async reporteX(@Body() body: unknown): Promise<unknown> {
    return this.impresion.reporteX(body);
  }

  /** Reporte Z (cierre diario). */
  @Post('reporte-z')
  @HttpCode(200)
  @RequierePermiso('impresion.reporte')
  async reporteZ(@Body() body: unknown): Promise<unknown> {
    return this.impresion.reporteZ(body);
  }

  /** Lectura de la memoria fiscal (rango opcional por número Z o por fecha). */
  @Post('memoria-fiscal')
  @HttpCode(200)
  @RequierePermiso('impresion.leer')
  async memoriaFiscal(@Body() body: unknown): Promise<unknown> {
    return this.impresion.leerMemoriaFiscal(body);
  }

  /** Diagnóstico de la cola de impresión (filtros opcionales `companyId`, `estado`). */
  @Get('cola')
  @RequierePermiso('impresion.leer')
  async cola(@Query() query: Record<string, unknown>): Promise<FilaPrintJob[]> {
    return this.impresion.listar(query);
  }
}
