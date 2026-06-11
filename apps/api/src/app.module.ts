import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';

@Module({
  imports: [DatabaseModule, AuditModule],
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
