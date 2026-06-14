import { Module } from '@nestjs/common';
import { AjustesService } from './ajustes.service';
import { AlertasService } from './alertas.service';
import { ConteosService } from './conteos.service';
import { InventarioController } from './inventario.controller';
import { MovimientosService } from './movimientos.service';
import { PreciosService } from './precios.service';
import { TrasladosService } from './traslados.service';

/**
 * Módulo de Inventario (P12, docs/06 M5, docs/05 §3.8): kardex y costo promedio ponderado en doble
 * base (stock_moves append-only), entradas/ventas con asiento (inventario permanente), ajustes con
 * motivo y aprobación (separación de deberes), traslados con estado EN_TRÁNSITO, conteos físicos cuyas
 * diferencias generan un ajuste, actualización masiva de precios y alerta de margen negativo en USD.
 * `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  controllers: [InventarioController],
  providers: [
    MovimientosService,
    AjustesService,
    TrasladosService,
    ConteosService,
    PreciosService,
    AlertasService,
  ],
  exports: [
    MovimientosService,
    AjustesService,
    TrasladosService,
    ConteosService,
    PreciosService,
    AlertasService,
  ],
})
export class InventarioModule {}
