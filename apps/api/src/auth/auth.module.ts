import { Module } from '@nestjs/common';
import { SeguridadModule } from '../seguridad/seguridad.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Autenticación de identidad (P27, docs/05 §6): login + sesión JWT, refresh rotativo, logout y
 * recuperación de contraseña, con el 2FA TOTP de P18 como segundo paso. Importa `SeguridadModule`
 * para reutilizar `SeguridadService.verificar` (segundo factor). La derivación tenant/actor desde
 * el JWT (cerrar el `TODO(auth)` del `TenantContextMiddleware`) llega en P28.
 */
@Module({
  imports: [SeguridadModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
