import { Controller } from '@nestjs/common';
import { priceLists } from '../db/schema';
import { CrudMaestroController } from './crud-maestro.controller';
import { PriceListsService } from './price-lists.service';

/** CRUD de listas de precios (P5). Permiso `price_list.manage` (regla 13) al cablear guards. */
@Controller('maestros/price-lists')
export class PriceListsController extends CrudMaestroController<typeof priceLists.$inferSelect> {
  constructor(protected readonly servicio: PriceListsService) {
    super();
  }
}
