import { Module } from '@nestjs/common';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AriArcService } from './ari-arc.service';
import { ConceptosService } from './conceptos.service';
import { CorridasService } from './corridas.service';
import { NominaController } from './nomina.controller';
import { ParafiscalesService } from './parafiscales.service';
import { PrestacionesService } from './prestaciones.service';
import { ProvisionesService } from './provisiones.service';
import { RecibosPdfService } from './recibos-pdf.service';
import { TrabajadoresService } from './trabajadores.service';

/**
 * Módulo de Nómina (P15, docs/04, docs/06 M8): fichas, conceptos con fórmulas seguras, corridas
 * (pre-nómina→aprobación→recibos→asiento), kardex de prestaciones y liquidación (art. 142),
 * provisiones mensuales, parafiscales con planillas (TIUNA/FAOV/INCES) y ARI/ARC. `DatabaseService`
 * y `AuditService` llegan por los módulos globales.
 */
@Module({
  imports: [UsuariosModule],
  controllers: [NominaController],
  providers: [
    TrabajadoresService,
    ConceptosService,
    CorridasService,
    PrestacionesService,
    ProvisionesService,
    ParafiscalesService,
    AriArcService,
    RecibosPdfService,
  ],
  exports: [TrabajadoresService, CorridasService, ProvisionesService],
})
export class NominaModule {}
