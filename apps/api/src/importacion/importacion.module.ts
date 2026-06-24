import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ImportacionController } from './importacion.controller';
import { ImportacionService } from './importacion.service';

/**
 * Importación de migración (P31, casos 45–46, docs/05 §5): para arrancar a un cliente que viene de
 * Gálac/Profit/Excel — terceros (dedup por RIF), ítems (costo y alícuota), CxC/CxP abiertas y saldos
 * iniciales que se integran al asiento de apertura (P30, vía `OnboardingModule`). `DatabaseService` y
 * `AuditService` llegan por los módulos globales.
 */
@Module({
  imports: [OnboardingModule],
  controllers: [ImportacionController],
  providers: [ImportacionService],
  exports: [ImportacionService],
})
export class ImportacionModule {}
