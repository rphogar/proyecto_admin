import { BadRequestException, Body, Controller, Get, Param, Post, Query, StreamableFile } from '@nestjs/common';
import { RequierePermiso } from '../seguridad/requiere-permiso.decorator';
import type { EntidadImport } from './parsers/tipos';
import { plantillaCsv, plantillaExcel } from './plantillas';
import {
  ImportacionService,
  type ResultadoCommit,
  type ResultadoDryRunApertura,
} from './importacion.service';
import type { ItemValidado, ReporteDryRun, TerceroValidado } from './mapeo';
import type { ResultadoApertura } from '../onboarding/onboarding.service';

const ENTIDADES: EntidadImport[] = ['TERCEROS', 'ITEMS', 'CXC', 'CXP', 'SALDOS'];

/** Prefijo BOM UTF-8 para que Excel respete acentos y el separador `;` al abrir el CSV es-VE. */
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);

function entidadDe(valor: string): EntidadImport {
  const v = valor.trim().toUpperCase() as EntidadImport;
  if (!ENTIDADES.includes(v)) {
    throw new BadRequestException(`entidad inválida: "${valor}" (use ${ENTIDADES.join(', ')})`);
  }
  return v;
}

/**
 * Importador de migración (P31, casos 45–46). Descarga de **plantillas** CSV/Excel, **dry-run** (vista
 * previa en seco con reporte de errores por fila, sin escribir) y **commit** por entidad: terceros,
 * ítems y apertura (saldos + CxC/CxP integrados al asiento de apertura P30). Pasa por
 * `TenantContextMiddleware`; las escrituras exigen `migracion.importar`, las lecturas `migracion.ver`.
 */
@Controller('importacion')
export class ImportacionController {
  constructor(private readonly importacion: ImportacionService) {}

  /** Descarga la plantilla de una entidad en CSV (default) o Excel (`?formato=excel`). */
  @Get('plantillas/:entidad')
  @RequierePermiso('migracion.ver')
  plantilla(@Param('entidad') entidad: string, @Query('formato') formato: string | undefined): StreamableFile {
    const ent = entidadDe(entidad);
    if ((formato ?? 'csv').toLowerCase() === 'excel') {
      const { buffer, filename } = plantillaExcel(ent);
      return new StreamableFile(buffer, { type: 'application/vnd.ms-excel', disposition: `attachment; filename="${filename}"` });
    }
    const { contenido, filename } = plantillaCsv(ent);
    const buffer = Buffer.concat([BOM_UTF8, Buffer.from(contenido, 'utf8')]);
    return new StreamableFile(buffer, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${filename}"` });
  }

  @Post('terceros/dry-run')
  @RequierePermiso('migracion.ver')
  dryRunTerceros(@Body() body: unknown): Promise<ReporteDryRun<TerceroValidado>> {
    return this.importacion.dryRunTerceros(body);
  }

  @Post('terceros')
  @RequierePermiso('migracion.importar')
  commitTerceros(@Body() body: unknown): Promise<ResultadoCommit<TerceroValidado>> {
    return this.importacion.commitTerceros(body);
  }

  @Post('items/dry-run')
  @RequierePermiso('migracion.ver')
  dryRunItems(@Body() body: unknown): Promise<ReporteDryRun<ItemValidado>> {
    return this.importacion.dryRunItems(body);
  }

  @Post('items')
  @RequierePermiso('migracion.importar')
  commitItems(@Body() body: unknown): Promise<ResultadoCommit<ItemValidado> & { preciosCargados: number }> {
    return this.importacion.commitItems(body);
  }

  @Post('apertura/dry-run')
  @RequierePermiso('migracion.ver')
  dryRunApertura(@Body() body: unknown): Promise<ResultadoDryRunApertura> {
    return this.importacion.dryRunApertura(body);
  }

  @Post('apertura')
  @RequierePermiso('migracion.importar')
  commitApertura(@Body() body: unknown): Promise<ResultadoApertura & { renglones: number }> {
    return this.importacion.commitApertura(body);
  }
}
