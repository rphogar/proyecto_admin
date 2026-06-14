import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { CobrosModule } from './cobros/cobros.module';
import { ComprasModule } from './compras/compras.module';
import { DatabaseModule } from './db/database.module';
import { DocumentosModule } from './documentos/documentos.module';
import { HealthController } from './health/health.controller';
import { ImpuestosModule } from './impuestos/impuestos.module';
import { InventarioModule } from './inventario/inventario.module';
import { MaestrosModule } from './maestros/maestros.module';
import { TasasModule } from './tasas/tasas.module';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';
import { TesoreriaModule } from './tesoreria/tesoreria.module';

@Module({
  imports: [DatabaseModule, AuditModule, TasasModule, MaestrosModule, DocumentosModule, CobrosModule, ComprasModule, ImpuestosModule, TesoreriaModule, InventarioModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // El contexto de tenant aplica a todo salvo /health (liveness sin tenant).
    consumer
      .apply(TenantContextMiddleware)
      .exclude({ path: 'health', method: RequestMethod.ALL })
      .forRoutes('*');
  }
}
