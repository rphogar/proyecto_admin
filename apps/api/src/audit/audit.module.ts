import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Auditoría disponible globalmente: cualquier servicio de negocio debe poder registrar
 * eventos sin reimportar el módulo.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
