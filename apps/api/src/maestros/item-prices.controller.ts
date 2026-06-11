import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ItemPricesService, type PrecioConItem } from './item-prices.service';

/**
 * Precios de ítems por lista (P5). Sub-recurso de listas de precios: se consulta por
 * `priceListId` y se fija con upsert. Permiso `price_list.manage` (regla 13) al cablear guards.
 */
@Controller('maestros/item-prices')
export class ItemPricesController {
  constructor(private readonly precios: ItemPricesService) {}

  @Get()
  async listar(@Query('priceListId') priceListId: string): Promise<PrecioConItem[]> {
    return this.precios.listarDeLista(priceListId);
  }

  @Put()
  async fijar(@Body() body: unknown) {
    return this.precios.fijar(body);
  }

  @Delete(':id')
  @HttpCode(204)
  async eliminar(@Param('id') id: string): Promise<void> {
    await this.precios.eliminar(id);
  }
}
