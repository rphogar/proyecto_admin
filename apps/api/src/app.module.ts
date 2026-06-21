import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { CobrosModule } from './cobros/cobros.module';
import { ComprasModule } from './compras/compras.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { CumplimientoModule } from './cumplimiento/cumplimiento.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './db/database.module';
import { DevModule } from './dev/dev.module';
import { DocumentosModule } from './documentos/documentos.module';
import { FacturacionDigitalModule } from './facturacion-digital/facturacion-digital.module';
import { HealthController } from './health/health.controller';
import { ImpresionFiscalModule } from './impresion-fiscal/impresion-fiscal.module';
import { ImpuestosModule } from './impuestos/impuestos.module';
import { InventarioModule } from './inventario/inventario.module';
import { MaestrosModule } from './maestros/maestros.module';
import { NominaModule } from './nomina/nomina.module';
import { PortalModule } from './portal/portal.module';
import { SeguridadModule } from './seguridad/seguridad.module';
import { TasasModule } from './tasas/tasas.module';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';
import { TesoreriaModule } from './tesoreria/tesoreria.module';

// Utilidades de desarrollo (login demo): nunca en producción (regla 14: nada de atajos en prod).
const DEV_MODULES = process.env.NODE_ENV === 'production' ? [] : [DevModule];

@Module({
  imports: [DatabaseModule, AuditModule, SeguridadModule, TasasModule, MaestrosModule, DocumentosModule, CobrosModule, ComprasModule, ImpuestosModule, TesoreriaModule, InventarioModule, ContabilidadModule, DashboardModule, NominaModule, PortalModule, CumplimientoModule, ImpresionFiscalModule, FacturacionDigitalModule, ...DEV_MODULES],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // El contexto de tenant aplica a todo salvo /health (liveness) y /dev/* (login demo sin tenant).
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'dev/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
