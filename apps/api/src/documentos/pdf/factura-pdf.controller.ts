import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { FacturaPdfService } from './factura-pdf.service';

/**
 * PDF de factura/NC/ND (P8): `GET /documentos/:id/pdf` devuelve el documento renderizado server-side
 * (`application/pdf`). Ruta separada del CRUD para no chocar con `GET /documentos/:id`.
 */
@Controller('documentos')
export class FacturaPdfController {
  constructor(private readonly pdf: FacturaPdfService) {}

  @Get(':id/pdf')
  @Header('Content-Type', 'application/pdf')
  async descargar(@Param('id') id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.pdf.generar(id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }
}
