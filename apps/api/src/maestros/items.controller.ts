import { Controller } from '@nestjs/common';
import { items } from '../db/schema';
import { CrudMaestroController } from './crud-maestro.controller';
import { ItemsService } from './items.service';

/** CRUD de ítems (P5). Permiso `item.manage` (regla 13) al cablear guards. */
@Controller('maestros/items')
export class ItemsController extends CrudMaestroController<typeof items.$inferSelect> {
  constructor(protected readonly servicio: ItemsService) {
    super();
  }
}
