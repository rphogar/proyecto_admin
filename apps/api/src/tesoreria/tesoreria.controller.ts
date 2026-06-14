import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { type BankAccount, BancosService } from './bancos.service';
import { type CierreConArqueo, CierresCajaService } from './cierres-caja.service';
import { ConciliacionService, type SugerenciasConciliacion } from './conciliacion.service';
import { ImportadoresService, type ResultadoImportacion } from './importadores.service';
import { PosicionService, type PosicionTesoreria } from './posicion.service';
import { type ResultadoRevaluacion, RevaluacionService } from './revaluacion.service';
import { type TransferenciaRegistrada, TransferenciasService } from './transferencias.service';
import { type bankStatements, type cierresCaja, type revaluaciones, type transferencias } from '../db/schema';

/**
 * Tesorería y conciliación (P11, docs/06 M4). Posición consolidada, transferencias internas con
 * conversión, cierres de caja con arqueo, importación de estados de cuenta, conciliación n:m y
 * revaluación mensual de saldos en divisas. Los permisos (`tesoreria.*`, seed en 0036) se cablean
 * con los guards de auth (regla 13).
 */
@Controller('tesoreria')
export class TesoreriaController {
  constructor(
    private readonly posicion: PosicionService,
    private readonly bancos: BancosService,
    private readonly transferencias: TransferenciasService,
    private readonly cierres: CierresCajaService,
    private readonly importadores: ImportadoresService,
    private readonly conciliacion: ConciliacionService,
    private readonly revaluacion: RevaluacionService,
  ) {}

  /** Posición consolidada (saldos por cuenta/método/moneda + total VES/USD), derivada del ledger. */
  @Get('posicion')
  async getPosicion(@Query('companyId') companyId: string): Promise<PosicionTesoreria> {
    return this.posicion.consolidada(companyId);
  }

  // ── Cuentas bancarias ──────────────────────────────────────────────────────
  @Post('bancos')
  async crearBanco(@Body() body: unknown): Promise<BankAccount> {
    return this.bancos.crear(body);
  }

  @Get('bancos')
  async listarBancos(@Query('companyId') companyId: string): Promise<BankAccount[]> {
    return this.bancos.listar(companyId);
  }

  // ── Transferencias internas ────────────────────────────────────────────────
  @Post('transferencias')
  async crearTransferencia(@Body() body: unknown): Promise<TransferenciaRegistrada> {
    return this.transferencias.registrar(body);
  }

  @Get('transferencias')
  async listarTransferencias(@Query('companyId') companyId: string): Promise<(typeof transferencias.$inferSelect)[]> {
    return this.transferencias.listar(companyId);
  }

  // ── Cierres de caja ────────────────────────────────────────────────────────
  @Post('cierres-caja/abrir')
  async abrirCaja(@Body() body: unknown): Promise<typeof cierresCaja.$inferSelect> {
    return this.cierres.abrir(body);
  }

  @Post('cierres-caja/cerrar')
  async cerrarCaja(@Body() body: unknown): Promise<CierreConArqueo> {
    return this.cierres.cerrar(body);
  }

  @Get('cierres-caja')
  async listarCierres(@Query('companyId') companyId: string): Promise<(typeof cierresCaja.$inferSelect)[]> {
    return this.cierres.listar(companyId);
  }

  // ── Importación de estados de cuenta ───────────────────────────────────────
  @Post('importar')
  async importar(@Body() body: unknown): Promise<ResultadoImportacion> {
    return this.importadores.importar(body);
  }

  @Get('estados')
  async listarEstados(@Query('companyId') companyId: string): Promise<(typeof bankStatements.$inferSelect)[]> {
    return this.importadores.listarEstados(companyId);
  }

  // ── Conciliación n:m ───────────────────────────────────────────────────────
  @Get('conciliacion')
  async sugerencias(@Query('companyId') companyId: string, @Query('bankAccountId') bankAccountId: string): Promise<SugerenciasConciliacion> {
    return this.conciliacion.sugerir(companyId, bankAccountId);
  }

  @Post('conciliacion')
  async conciliar(@Body() body: unknown): Promise<{ grupos: number; filas: number }> {
    return this.conciliacion.conciliar(body);
  }

  @Post('conciliacion/aceptar')
  async aceptarSugerencias(@Body() body: unknown): Promise<{ grupos: number; filas: number }> {
    const b = body as { companyId: string; bankAccountId: string };
    return this.conciliacion.aceptarSugerencias(b.companyId, b.bankAccountId);
  }

  @Post('conciliacion/en-transito')
  async marcarEnTransito(@Body() body: unknown): Promise<{ actualizadas: number }> {
    return this.conciliacion.marcarEnTransito(body);
  }

  // ── Revaluación mensual de saldos en divisas ───────────────────────────────
  @Post('revaluacion')
  async revaluar(@Body() body: unknown): Promise<ResultadoRevaluacion> {
    return this.revaluacion.ejecutar(body);
  }

  @Get('revaluacion')
  async listarRevaluaciones(@Query('companyId') companyId: string): Promise<(typeof revaluaciones.$inferSelect)[]> {
    return this.revaluacion.listar(companyId);
  }
}
