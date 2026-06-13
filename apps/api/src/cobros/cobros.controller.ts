import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type CobroRegistrado, CobrosService } from './cobros.service';
import { requireUuid } from '../maestros/validacion';

/**
 * Cobros (P8, docs/06 M3). `POST /cobros` registra el cobro (split multimoneda, IGTF, diferencial,
 * vuelto) en una transacción única; `GET /cobros` lista los de la empresa. El permiso `cobro.create`
 * (regla 13) se cablea con los guards de auth.
 */
@Controller('cobros')
export class CobrosController {
  constructor(private readonly cobros: CobrosService) {}

  @Post()
  async registrar(@Body() body: unknown): Promise<CobroRegistrado> {
    return this.cobros.registrar(body);
  }

  @Get()
  async listar(@Query('companyId') companyId: unknown): Promise<(CobroRegistrado['cobro'])[]> {
    return this.cobros.listar(requireUuid(companyId, 'companyId'));
  }
}
