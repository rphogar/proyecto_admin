import { Module } from '@nestjs/common';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { BancosService } from './bancos.service';
import { CierresCajaService } from './cierres-caja.service';
import { ConciliacionService } from './conciliacion.service';
import { ImportadoresService } from './importadores.service';
import { PosicionService } from './posicion.service';
import { RevaluacionService } from './revaluacion.service';
import { TesoreriaController } from './tesoreria.controller';
import { TransferenciasService } from './transferencias.service';

/**
 * Módulo de Tesorería y conciliación (P11, docs/06 M4): posición consolidada derivada del ledger,
 * transferencias internas con conversión y diferencial, cierres de caja con arqueo por método,
 * importación de estados de cuenta (parsers versionados Banesco/Mercantil), conciliación n:m con
 * score y revaluación mensual idempotente de saldos en divisas. `DatabaseService` y `AuditService`
 * llegan por los módulos globales.
 */
@Module({
  imports: [UsuariosModule],
  controllers: [TesoreriaController],
  providers: [PosicionService, BancosService, TransferenciasService, CierresCajaService, ImportadoresService, ConciliacionService, RevaluacionService],
  exports: [PosicionService, TransferenciasService, CierresCajaService, ImportadoresService, ConciliacionService, RevaluacionService],
})
export class TesoreriaModule {}
