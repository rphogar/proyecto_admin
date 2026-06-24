import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CobrosModule } from './cobros/cobros.module';
import { ComprasModule } from './compras/compras.module';
import { ContabilidadModule } from './contabilidad/contabilidad.module';
import { CumplimientoModule } from './cumplimiento/cumplimiento.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './db/database.module';
import { DocumentosModule } from './documentos/documentos.module';
import { FacturacionDigitalModule } from './facturacion-digital/facturacion-digital.module';
import { HealthController } from './health/health.controller';
import { ImpresionFiscalModule } from './impresion-fiscal/impresion-fiscal.module';
import { ImpuestosModule } from './impuestos/impuestos.module';
import { InventarioModule } from './inventario/inventario.module';
import { MaestrosModule } from './maestros/maestros.module';
import { NominaModule } from './nomina/nomina.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { PortalModule } from './portal/portal.module';
import { SeguridadModule } from './seguridad/seguridad.module';
import { TasasModule } from './tasas/tasas.module';
import { TenantContextOpcionalMiddleware } from './tenant/tenant-context-opcional.middleware';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';
import { TesoreriaModule } from './tesoreria/tesoreria.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [DatabaseModule, AuditModule, SeguridadModule, AuthModule, TasasModule, MaestrosModule, DocumentosModule, CobrosModule, ComprasModule, ImpuestosModule, TesoreriaModule, InventarioModule, ContabilidadModule, DashboardModule, NominaModule, PortalModule, CumplimientoModule, ImpresionFiscalModule, FacturacionDigitalModule, UsuariosModule, OnboardingModule],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `GET /tasas/dia` lee la tasa BCV (global): contexto OPCIONAL para que la landing pública la
    // muestre sin sesión, y un tenant logueado vea también su tasa MANUAL propia (caso 57).
    const RUTA_TASA_PUBLICA = { path: 'tasas/dia', method: RequestMethod.GET };
    consumer.apply(TenantContextOpcionalMiddleware).forRoutes(RUTA_TASA_PUBLICA);
    // El contexto de tenant (derivado del JWT, P28) aplica a todo lo demás salvo /health (liveness),
    // /auth/* (autenticación y cambio de empresa: verifican el Bearer a mano, ver AuthController) y
    // la ruta pública de la tasa (cubierta arriba por el middleware opcional).
    consumer
      .apply(TenantContextMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'auth/(.*)', method: RequestMethod.ALL },
        // P29 — Aceptación de invitación (peek/aceptar): PRE-tenant, resuelve por token (ver
        // InvitacionesController). La ADMINISTRACIÓN (`/usuarios/*`) sí pasa por el middleware.
        { path: 'invitaciones', method: RequestMethod.ALL },
        { path: 'invitaciones/(.*)', method: RequestMethod.ALL },
        RUTA_TASA_PUBLICA,
      )
      .forRoutes('*');
  }
}
