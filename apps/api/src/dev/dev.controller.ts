import { Controller, Get, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { DEMO } from '../db/demo-fixtures';
import { tenants } from '../db/schema';

/** Sesión demo que el frontend usa para arrancar el contexto sin auth real (solo desarrollo). */
export interface SesionDemoDto {
  tenantId: string;
  companyId: string;
  userId: string;
  tenantNombre: string;
  empresaNombre: string;
  usuarioEmail: string;
}

/**
 * Controlador de utilidades de DESARROLLO. El módulo que lo expone NO se monta en producción
 * (ver `app.module.ts`) y la ruta se excluye del middleware de tenant (no requiere `x-tenant-id`).
 *
 * Sustituye al "pegar UUID" del selector de empresa por un login de un clic mientras la auth real
 * (login/JWT/membresías) no esté construida. TODO(auth): reemplazar por el flujo de sesión real.
 */
@Controller('dev')
export class DevController {
  constructor(private readonly database: DatabaseService) {}

  /** Devuelve la sesión de la empresa DEMO; 404 con pista si aún no se corrió `db:seed-demo`. */
  @Get('sesion')
  async sesion(): Promise<SesionDemoDto> {
    // `tenants` no tiene RLS, así que esta lectura no necesita contexto de tenant.
    const [fila] = await this.database.db
      .select({ nombre: tenants.nombre })
      .from(tenants)
      .where(eq(tenants.id, DEMO.tenant.id))
      .limit(1);
    if (fila === undefined) {
      throw new NotFoundException('Empresa DEMO no encontrada. Ejecuta `pnpm db:seed-demo`.');
    }
    return {
      tenantId: DEMO.tenant.id,
      companyId: DEMO.empresa.id,
      userId: DEMO.usuario.id,
      tenantNombre: fila.nombre,
      empresaNombre: DEMO.empresa.razonSocial,
      usuarioEmail: DEMO.usuario.email,
    };
  }
}
