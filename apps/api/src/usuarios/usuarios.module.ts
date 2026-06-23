import { Module } from '@nestjs/common';
import { SeguridadModule } from '../seguridad/seguridad.module';
import { InvitacionesController } from './invitaciones.controller';
import { SegregacionService } from './segregacion.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

/**
 * Gestión de usuarios por tenant (P29, docs/05 §6, docs/06 M12): invitaciones por email, roles,
 * baja/reactivación, transferencia de propiedad y separación de deberes configurable. Importa
 * `SeguridadModule` para reutilizar `PermisosService` (catálogo RBAC del visor + rol del actor).
 * `DatabaseService` y `AuditService` llegan por los módulos globales. `SegregacionService` se exporta
 * para que los servicios que tienen pasos de aprobación (nómina) puedan exigir la separación.
 */
@Module({
  imports: [SeguridadModule],
  controllers: [UsuariosController, InvitacionesController],
  providers: [UsuariosService, SegregacionService],
  exports: [SegregacionService],
})
export class UsuariosModule {}
