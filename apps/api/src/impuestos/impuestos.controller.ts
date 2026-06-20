import { BadRequestException, Body, Controller, Get, Post, Query, StreamableFile } from '@nestjs/common';
import type { TipoAnticipo } from '@contave/fiscal-engine';
import type { EntradaCalendarioSpe } from '../portal/obligaciones';
import { type AnticipoBorrador, type DeclaracionIgtfBorrador, DeclaracionesService, type PlanillaIvaBorrador } from './declaraciones.service';
import { generarLibroExcel } from './export/libro-excel';
import { generarLibroPdf } from './export/libro-pdf';
import { type Libro, LibrosService } from './libros.service';
import { type ArcProveedor, type ControlFacturasAspe, RetencionesControlService } from './retenciones-control.service';
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
    private readonly control: RetencionesControlService,
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

  @Get('anticipo')
  async anticipo(@Query() q: Record<string, string>): Promise<AnticipoBorrador> {
    const { companyId, anio, mes } = parseLibroQuery(q);
    const tipo = parseTipoAnticipo(q.tipo);
    const subperiodo = parseSubperiodo(q.subperiodo);
    return this.declaraciones.anticipoBorrador(companyId, tipo, anio, mes, subperiodo);
  }

  // ── Calendario SPE (datos por providencia, regla 17) ─────────────────────────
  @Get('calendario-spe')
  async calendarioSpe(@Query('anio') anioRaw: string): Promise<{ anio: number; entradas: EntradaCalendarioSpe[] }> {
    const anio = Number(anioRaw);
    if (!Number.isInteger(anio)) throw new BadRequestException('anio es obligatorio y debe ser entero');
    return { anio, entradas: await this.declaraciones.obtenerCalendarioSpe(anio) };
  }

  @Post('calendario-spe/importar')
  async importarCalendarioSpe(@Body() body: Record<string, unknown>): Promise<{ anio: number; entradas: number }> {
    const anio = Number(body.anio);
    if (!Number.isInteger(anio)) throw new BadRequestException('anio es obligatorio y debe ser entero');
    if (!Array.isArray(body.entradas)) throw new BadRequestException('entradas debe ser un arreglo');
    return this.declaraciones.importarCalendarioSpe(anio, body.entradas as EntradaCalendarioSpe[]);
  }

  // ── Control de retenciones (caso 28) y ARC anual de ISLR ─────────────────────
  /** Facturas a clientes SPE sin comprobante de retención recibido (atrasadas > umbralDias, caso 28). */
  @Get('retenciones/control-spe')
  async controlFacturasAspe(@Query() q: Record<string, string>): Promise<ControlFacturasAspe> {
    if (!q.companyId) throw new BadRequestException('companyId es obligatorio');
    const umbral = q.dias == null || q.dias === '' ? undefined : Number(q.dias);
    if (umbral !== undefined && !Number.isInteger(umbral)) throw new BadRequestException('dias debe ser entero');
    return this.control.facturasAspeSinComprobante(q.companyId, umbral);
  }

  /** ARC anual de ISLR por proveedor de un ejercicio (opcional partyId para uno solo). */
  @Get('retenciones/arc-islr')
  async arcIslr(@Query() q: Record<string, string>): Promise<ArcProveedor[]> {
    if (!q.companyId) throw new BadRequestException('companyId es obligatorio');
    const ejercicio = Number(q.ejercicio);
    if (!Number.isInteger(ejercicio)) throw new BadRequestException('ejercicio es obligatorio y debe ser entero');
    return this.control.arcIslrProveedores(q.companyId, ejercicio, q.partyId ?? null);
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
    const tiposValidos = ['IVA', 'IGTF', 'ANTICIPO_IVA', 'ANTICIPO_ISLR'];
    if (!tiposValidos.includes(tipo)) throw new BadRequestException(`tipo debe ser uno de: ${tiposValidos.join(', ')}`);
    const { anio, mes } = parsePeriodo(body.anio, body.mes);
    const numeroDeclaracion = body.numeroDeclaracion == null ? null : String(body.numeroDeclaracion);
    return this.declaraciones.presentar({
      companyId,
      tipo: tipo as 'IVA' | 'IGTF' | TipoAnticipo,
      anio,
      mes,
      numeroDeclaracion,
      ...(body.subperiodo == null ? {} : { subperiodo: parseSubperiodo(String(body.subperiodo)) }),
    });
  }
}

// ── Helpers de parseo ──────────────────────────────────────────────────────────

function parseLibroQuery(q: Record<string, string>): { companyId: string; anio: number; mes: number } {
  if (!q.companyId) throw new BadRequestException('companyId es obligatorio');
  const { anio, mes } = parsePeriodo(q.anio, q.mes);
  return { companyId: q.companyId, anio, mes };
}

function parseTipoAnticipo(raw: string | undefined): TipoAnticipo {
  const t = String(raw ?? '').toUpperCase();
  if (t !== 'ANTICIPO_IVA' && t !== 'ANTICIPO_ISLR') {
    throw new BadRequestException('tipo debe ser ANTICIPO_IVA o ANTICIPO_ISLR');
  }
  return t;
}

function parseSubperiodo(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('subperiodo debe ser un entero ≥ 1 (la fracción)');
  return n;
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
