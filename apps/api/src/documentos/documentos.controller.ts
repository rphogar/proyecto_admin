import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import {
  type DocumentoConDetalle,
  DocumentosService,
  type ResultadoCalculo,
} from './documentos.service';
import { type DocumentoEmitido, EmisionService } from './emision.service';

/**
 * Documentos de venta (P6/P8). La emisión (`/emitir`) ejecuta la transacción única (correlativo,
 * asiento, inmutabilidad, auditoría). El editor de factura usa `/calcular` para los totales en vivo
 * y el validador, y el ciclo de BORRADOR (`POST/PUT/GET/DELETE` + `:id/emitir`). Los permisos
 * (`document.issue`, `document.read`) los aplica `PermisosGuard` por endpoint (regla 13, P18).
 */
@Controller('documentos')
export class DocumentosController {
  constructor(
    private readonly emision: EmisionService,
    private readonly documentos: DocumentosService,
  ) {}

  /** Cálculo en vivo (sin persistir): totales por alícuota, validador e IGTF estimado. */
  @Post('calcular')
  @HttpCode(200)
  @RequierePermiso('document.read')
  async calcular(@Body() body: unknown): Promise<ResultadoCalculo> {
    return this.documentos.calcular(body);
  }

  /** Emisión ad-hoc (sin borrador previo). */
  @Post('emitir')
  @RequierePermiso('document.issue')
  async emitir(@Body() body: unknown): Promise<DocumentoEmitido> {
    return this.emision.emitir(body);
  }

  /** Lista documentos de la empresa (filtros opcionales `type`, `status`). */
  @Get()
  @RequierePermiso('document.read')
  async listar(@Query() query: Record<string, unknown>): Promise<(DocumentoConDetalle['documento'])[]> {
    return this.documentos.listar(query);
  }

  /** Detalle de un documento (cabecera + líneas + impuestos). */
  @Get(':id')
  @RequierePermiso('document.read')
  async obtener(@Param('id') id: string): Promise<DocumentoConDetalle> {
    return this.documentos.obtener(id);
  }

  /** Crea un borrador (DRAFT). */
  @Post()
  @RequierePermiso('document.issue')
  async crear(@Body() body: unknown): Promise<DocumentoConDetalle> {
    return this.documentos.crearBorrador(body);
  }

  /** Actualiza un borrador. */
  @Put(':id')
  @RequierePermiso('document.issue')
  async actualizar(@Param('id') id: string, @Body() body: unknown): Promise<DocumentoConDetalle> {
    return this.documentos.actualizarBorrador(id, body);
  }

  /** Emite un borrador existente. */
  @Post(':id/emitir')
  @RequierePermiso('document.issue')
  async emitirBorrador(@Param('id') id: string): Promise<DocumentoEmitido> {
    return this.documentos.emitirBorrador(id);
  }

  /** Elimina un borrador. */
  @Delete(':id')
  @HttpCode(204)
  @RequierePermiso('document.issue')
  async eliminar(@Param('id') id: string): Promise<void> {
    return this.documentos.eliminar(id);
  }
}
