import { Body, Controller, Post } from '@nestjs/common';
import { type DocumentoEmitido, EmisionService } from './emision.service';

/**
 * Emisión de documentos (P6). `POST /documentos/emitir` ejecuta la transacción única de emisión.
 * El permiso `document.issue` (regla 13) se cablea con los guards de la capa de auth.
 */
@Controller('documentos')
export class DocumentosController {
  constructor(private readonly emision: EmisionService) {}

  @Post('emitir')
  async emitir(@Body() body: unknown): Promise<DocumentoEmitido> {
    return this.emision.emitir(body);
  }
}
