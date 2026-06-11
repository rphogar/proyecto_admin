import { Body, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { CrudMaestroService } from './crud-maestro';

/**
 * Controlador base de un maestro CRUD (P5). Las subclases solo añaden `@Controller('maestros/...')`
 * y pasan su servicio; NestJS hereda las rutas decoradas aquí. `companyId` es obligatorio en el
 * listado (multi-empresa, doc 06). El enforcement de permisos (`*.manage`, regla 13) se cableará
 * con los guards.
 */
export abstract class CrudMaestroController<Fila> {
  protected abstract readonly servicio: CrudMaestroService<Fila & Record<string, unknown>, unknown>;

  @Get()
  async listar(@Query('companyId') companyId: string): Promise<Fila[]> {
    return this.servicio.listar(companyId);
  }

  @Get(':id')
  async obtener(@Param('id') id: string): Promise<Fila> {
    return this.servicio.obtener(id);
  }

  @Post()
  async crear(@Body() body: unknown): Promise<Fila> {
    return this.servicio.crear(body);
  }

  @Put(':id')
  async actualizar(@Param('id') id: string, @Body() body: unknown): Promise<Fila> {
    return this.servicio.actualizar(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async eliminar(@Param('id') id: string): Promise<void> {
    await this.servicio.eliminar(id);
  }
}
