import { Controller } from '@nestjs/common';
import { series } from '../db/schema';
import { CrudMaestroController } from './crud-maestro.controller';
import { SeriesService } from './series.service';

/** CRUD de series de documentos (P5). Permiso `series.manage` (regla 13) al cablear guards. */
@Controller('maestros/series')
export class SeriesController extends CrudMaestroController<typeof series.$inferSelect> {
  constructor(protected readonly servicio: SeriesService) {
    super();
  }
}
