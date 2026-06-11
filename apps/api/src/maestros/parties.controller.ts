import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { PartiesService } from './parties.service';

/**
 * CRUD de terceros (P5). Lectura/escritura requerirán los permisos `party.manage` (regla 13)
 * cuando los guards estén cableados. `companyId` es obligatorio en el listado (multi-empresa,
 * doc 06: selector de empresa).
 */
@Controller('maestros/parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get()
  async listar(@Query('companyId') companyId: string) {
    return this.parties.listar(companyId);
  }

  @Get(':id')
  async obtener(@Param('id') id: string) {
    return this.parties.obtener(id);
  }

  @Post()
  async crear(@Body() body: unknown) {
    return this.parties.crear(body);
  }

  @Put(':id')
  async actualizar(@Param('id') id: string, @Body() body: unknown) {
    return this.parties.actualizar(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async eliminar(@Param('id') id: string): Promise<void> {
    await this.parties.eliminar(id);
  }
}
