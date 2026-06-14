import { BadRequestException, Body, Controller, Get, Post, Query, StreamableFile } from '@nestjs/common';
import { type DeclaracionIgtfBorrador, DeclaracionesService, type PlanillaIvaBorrador } from './declaraciones.service';
import { generarLibroExcel } from './export/libro-excel';
import { generarLibroPdf } from './export/libro-pdf';
import { type Libro, LibrosService } from './libros.service';
import type { taxReturns } from '../db/schema';

/**
 * Módulo de Impuestos (P10, docs/06 M7): Libros de Compras/Ventas (vista + PDF/Excel), planilla
 * borrador de IVA, declaración de IGTF y presentación de declaraciones (snapshot inmutable). Los
 * permisos (`libro.view`, `declaracion.view`, `declaracion.present`) se cablean con los guards de
 * auth (regla 13; seed en 0032).
 */
@Controller('impuestos')
export class ImpuestosController {
  constructor(
    private readonly libros: LibrosService,
    private readonly declaraciones: DeclaracionesService,
  ) {}

  // ── Libros ──────────────────────────────────────────────────────────────────
  @Get('libro-ventas')
  async libroVentas(@Query() q: Record<string, string>): Promise<Libro> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    return this.libros.libroVentas(companyId, anio, mes);
  }

  @Get('libro-compras')
  async libroCompras(@Query() q: Record<string, string>): Promise<Libro> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    return this.libros.libroCompras(companyId, anio, mes);
  }

  @Get('libro-ventas/pdf')
  async libroVentasPdf(@Query() q: Record<string, string>): Promise<StreamableFile> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    const { buffer, filename } = await generarLibroPdf(await this.libros.libroVentas(companyId, anio, mes));
    return pdf(buffer, filename);
  }

  @Get('libro-compras/pdf')
  async libroComprasPdf(@Query() q: Record<string, string>): Promise<StreamableFile> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    const { buffer, filename } = await generarLibroPdf(await this.libros.libroCompras(companyId, anio, mes));
    return pdf(buffer, filename);
  }

  @Get('libro-ventas/excel')
  async libroVentasExcel(@Query() q: Record<string, string>): Promise<StreamableFile> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    const { buffer, filename } = generarLibroExcel(await this.libros.libroVentas(companyId, anio, mes));
    return excel(buffer, filename);
  }

  @Get('libro-compras/excel')
  async libroComprasExcel(@Query() q: Record<string, string>): Promise<StreamableFile> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    const { buffer, filename } = generarLibroExcel(await this.libros.libroCompras(companyId, anio, mes));
    return excel(buffer, filename);
  }

  // ── Declaraciones ─────────────────────────────────────────────────────────────
  @Get('iva')
  async planillaIva(@Query() q: Record<string, string>): Promise<PlanillaIvaBorrador> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    return this.declaraciones.planillaIva(companyId, anio, mes);
  }

  @Get('igtf')
  async declaracionIgtf(@Query() q: Record<string, string>): Promise<DeclaracionIgtfBorrador> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    return this.declaraciones.declaracionIgtf(companyId, anio, mes);
  }

  @Get('declaraciones')
  async listarDeclaraciones(@Query('companyId') companyId: string): Promise<(typeof taxReturns.$inferSelect)[]> {
    if (!companyId) throw new BadRequestException('companyId es obligatorio');
    return this.declaraciones.listar(companyId);
  }

  @Post('declaraciones/presentar')
  async presentar(@Body() body: Record<string, unknown>): Promise<typeof taxReturns.$inferSelect> {
    const companyId = String(body.companyId ?? '');
    if (!companyId) throw new BadRequestException('companyId es obligatorio');
    const tipo = String(body.tipo ?? '').toUpperCase();
    if (tipo !== 'IVA' && tipo !== 'IGTF') throw new BadRequestException('tipo debe ser IVA o IGTF');
    const { anio, mes } = parsePeriodo(body.anio, body.mes);
    const numeroDeclaracion = body.numeroDeclaracion == null ? null : String(body.numeroDeclaracion);
    return this.declaraciones.presentar({ companyId, tipo: tipo as 'IVA' | 'IGTF', anio, mes, numeroDeclaracion });
  }
}

// ── Helpers de parseo ──────────────────────────────────────────────────────────

function parseLibroQuery(q: Record<string, string>): { companyId: string; anio: number; mes: number } {
  if (!q.companyId) throw new BadRequestException('companyId es obligatorio');
  const { anio, mes } = parsePeriodo(q.anio, q.mes);
  return { companyId: q.companyId, anio, mes };
}

function parsePeriodo(anioRaw: unknown, mesRaw: unknown): { anio: number; mes: number } {
  const anio = Number(anioRaw);
  const mes = Number(mesRaw);
  if (!Number.isInteger(anio) || !Number.isInteger(mes)) {
    throw new BadRequestException('anio y mes son obligatorios y deben ser enteros');
  }
  return { anio, mes };
}

function pdf(buffer: Buffer, filename: string): StreamableFile {
  return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${filename}"` });
}

function excel(buffer: Buffer, filename: string): StreamableFile {
  return new StreamableFile(buffer, { type: 'application/vnd.ms-excel', disposition: `attachment; filename="${filename}"` });
}
