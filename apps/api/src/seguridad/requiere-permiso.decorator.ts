import { SetMetadata } from '@nestjs/common';

/** Clave de metadatos donde el decorador deja el permiso requerido por un handler. */
export const PERMISO_METADATA = 'contave:requiere_permiso';

/**
 * Declara el permiso de ACCIÓN que exige un endpoint (regla 13). Lo lee `PermisosGuard`.
 *
 * @example
 *   @RequierePermiso('document.issue')
 *   @Post('emitir')
 *   emitir() { ... }
 */
export const RequierePermiso = (permiso: string): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISO_METADATA, permiso);
