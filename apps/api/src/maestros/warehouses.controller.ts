import { Controller } from '@nestjs/common';
import { warehouses } from '../db/schema';
import { CrudMaestroController } from './crud-maestro.controller';
import { WarehousesService } from './warehouses.service';

/** CRUD de almacenes (P5). Permiso `warehouse.manage` (regla 13) al cablear guards. */
@Controller('maestros/warehouses')
export class WarehousesController extends CrudMaestroController<typeof warehouses.$inferSelect> {
  constructor(protected readonly servicio: WarehousesService) {
    super();
  }
}
