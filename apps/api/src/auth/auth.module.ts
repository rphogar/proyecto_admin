import { Module } from '@nestjs/common';
import { SeguridadModule } from '../seguridad/seguridad.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Autenticación de identidad (P27/P28, docs/05 §6): login + sesión JWT acotada a tenant, refresh
 * rotativo, logout, recuperación de contraseña y cambio de empresa, con el 2FA TOTP de P18 como
 * segundo paso. Importa `SeguridadModule` para reutilizar `SeguridadService.verificar` (segundo
 * factor) y `PermisosService` (membresías del usuario, validación del cambio de empresa).
 */
@Module({
  imports: [SeguridadModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
