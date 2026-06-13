import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { retentionsIssued } from '../../db/schema';
import { asegurarEmpresaDelTenant } from '../../maestros/companias';
import { withTenant } from '../../tenant/with-tenant';
import { RetencionComprobantePdfService } from './comprobante-pdf.service';

/**
 * Comprobante de retención (P9): `GET /compras/retenciones/:id/pdf` devuelve el comprobante
 * renderizado server-side, y `GET /compras/retenciones/:id/txt` la línea TXT del portal SENIAT
 * (solo retenciones de IVA). Rutas bajo `/compras/retenciones` para no chocar con el CRUD.
 */
@Controller('compras/retenciones')
export class RetencionComprobantePdfController {
  constructor(
    private readonly pdf: RetencionComprobantePdfService,
    private readonly database: DatabaseService,
  ) {}

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async descargarPdf(@Param('id') id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.pdf.generar(id);
    return new StreamableFile(buffer, { type: 'application/pdf', disposition: `inline; filename="${filename}"` });
  }

  @Get(':id/txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async descargarTxt(@Param('id') id: string): Promise<StreamableFile> {
    const comprobante = await withTenant(this.database.db, async (tx) => {
      const [c] = await tx.select().from(retentionsIssued).where(eq(retentionsIssued.id, id)).limit(1);
      if (c === undefined) throw new NotFoundException(`Comprobante ${id} no encontrado`);
      await asegurarEmpresaDelTenant(tx, c.companyId);
      return c;
    });
    if (comprobante.tipo !== 'IVA' || comprobante.txtExport === null) {
      throw new NotFoundException('El TXT del portal SENIAT solo aplica a retenciones de IVA');
    }
    return new StreamableFile(Buffer.from(comprobante.txtExport, 'utf-8'), {
      type: 'text/plain',
      disposition: `attachment; filename="RET-IVA-${comprobante.numeroComprobante}.txt"`,
    });
  }
}
