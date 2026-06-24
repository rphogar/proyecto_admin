import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Onboarding (P30, docs/06 flujo #5, M12): alta guiada de empresa — inferencia de perfil tributario,
 * precarga de configuración (plan de cuentas, plantillas, métodos de pago, series, período) y asiento
 * de apertura en triple base. `DatabaseService` y `AuditService` llegan por los módulos globales.
 */
@Module({
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
