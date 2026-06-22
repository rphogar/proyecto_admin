import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PermiteSin2FA } from '../seguridad/dos-factores.guard';
import { CapturaBcvService, type ResultadoCaptura } from './captura-bcv.service';
import { parsearTasaManual, validarFecha, validarMoneda } from './dto';
import {
  type TasaDelDiaDto,
  type TasaDto,
  TasasService,
} from './tasas.service';

/**
 * API de tasas de cambio (P4). Lectura abierta a la app; la entrada MANUAL requerirá el permiso
 * `exchange_rate.manage` (regla 13) cuando la capa de auth/guards esté cableada.
 */
@Controller('tasas')
export class TasasController {
  constructor(
    private readonly tasas: TasasService,
    private readonly captura: CapturaBcvService,
  ) {}

  /**
   * Tasa del día (o de `fecha`) con estado de frescura para el banner (caso 57). Lectura PÚBLICA de
   * un dato global (tasa BCV): exenta de 2FA para que la landing la muestre y un owner sin enrolar
   * el segundo factor aún vea la tasa informativa (no toca dinero ni datos del tenant).
   */
  @PermiteSin2FA()
  @Get('dia')
  async tasaDelDia(
    @Query('moneda') moneda?: string,
    @Query('fecha') fecha?: string,
  ): Promise<TasaDelDiaDto> {
    const m = validarMoneda(moneda ?? 'USD');
    const f = fecha === undefined ? undefined : validarFecha(fecha);
    return this.tasas.tasaDelDia(m, f);
  }

  /** Historial de tasas de una moneda en un rango `[desde, hasta]`. */
  @Get()
  async historial(
    @Query('moneda') moneda?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<TasaDto[]> {
    return this.tasas.historial(
      validarMoneda(moneda ?? 'USD'),
      validarFecha(desde, 'desde'),
      validarFecha(hasta, 'hasta'),
    );
  }

  /** Entrada manual auditada (regla 5). TODO: exigir permiso `exchange_rate.manage` con guards. */
  @Post('manual')
  async crearManual(@Body() body: unknown): Promise<TasaDto> {
    return this.tasas.crearManual(parsearTasaManual(body));
  }

  /** Dispara la captura BCV manualmente (operación/verify). El job la corre en cron. */
  @Post('capturar')
  async capturar(@Body() body?: { fecha?: string }): Promise<ResultadoCaptura> {
    const fecha = body?.fecha === undefined ? undefined : validarFecha(body.fecha);
    return this.captura.capturar(fecha);
  }
}
