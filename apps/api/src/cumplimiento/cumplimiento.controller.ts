import { Body, Controller, Get, Header, Post, Query, StreamableFile } from '@nestjs/common';
import { type InformeCumplimiento, informeCumplimiento } from './compliance-report';
import { ExpedienteService } from './expediente.service';
import { type FilaEventoFiscal, FiscalEventLogService } from './fiscal-event-log.service';
import { type FilaRemision, RemisionService } from './remision.service';

/**
 * Cumplimiento Providencia SNAT/2024/000121 (P17, docs/02 §6.3, docs/05 §3.9). Expone la bitácora
 * fiscal y su verificación de integridad, la cola de remisión al SENIAT y su procesamiento, el
 * informe de cumplimiento y el expediente técnico de homologación. Los permisos (`cumplimiento.*`,
 * seed en 0056) se cablean con los guards de auth (regla 13).
 */
@Controller('cumplimiento')
export class CumplimientoController {
  constructor(
    private readonly eventos: FiscalEventLogService,
    private readonly remision: RemisionService,
    private readonly expediente: ExpedienteService,
  ) {}

  // ── Bitácora fiscal ───────────────────────────────────────────────────────────
  @Get('eventos')
  async listarEventos(@Query() query: Record<string, unknown>): Promise<FilaEventoFiscal[]> {
    return this.eventos.listar(query);
  }

  /** Registra manualmente un evento de impresión/reimpresión/anulación/fallo. */
  @Post('eventos')
  async registrarEvento(@Body() body: unknown): Promise<FilaEventoFiscal> {
    return this.eventos.registrarManual(body);
  }

  /** Reverifica la integridad de la cadena de eventos del tenant. */
  @Get('eventos/verificacion')
  async verificar() {
    return this.eventos.verificarCadena();
  }

  // ── Cola de remisión al SENIAT ──────────────────────────────────────────────────
  @Get('remision')
  async listarRemision(@Query() query: Record<string, unknown>): Promise<FilaRemision[]> {
    return this.remision.listar(query);
  }

  /** Procesa los ítems pendientes (en producción lo dispara un job; aquí, manual/scheduler). */
  @Post('remision/procesar')
  async procesar(@Body() body: unknown) {
    const limite = (body as { limite?: unknown } | null)?.limite;
    return this.remision.procesarPendientes(limite);
  }

  /** Reabre un ítem en ERROR para reintentarlo. */
  @Post('remision/reintentar')
  async reintentar(@Body() body: unknown): Promise<FilaRemision> {
    return this.remision.reintentar(body);
  }

  // ── Informe de cumplimiento ─────────────────────────────────────────────────────
  @Get('informe')
  informe(): InformeCumplimiento {
    return informeCumplimiento();
  }

  // ── Expediente técnico de homologación ──────────────────────────────────────────
  @Get('expediente')
  async expedienteJson() {
    return this.expediente.generar();
  }

  /** Descarga el expediente técnico serializado (JSON). */
  @Get('expediente/export')
  @Header('Content-Type', 'application/json')
  async exportarExpediente(): Promise<StreamableFile> {
    const { buffer, filename } = await this.expediente.exportar();
    return new StreamableFile(buffer, { type: 'application/json', disposition: `attachment; filename="${filename}"` });
  }
}
