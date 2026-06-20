import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { memberships, rolePermissions } from '../db/schema';
import { withTenant } from '../tenant/with-tenant';

/**
 * Resuelve la autorización RBAC por ACCIÓN (regla 13, docs/05 §6). La matriz rol→permisos vive en
 * el catálogo global `role_permissions` (sembrado en migraciones), de modo que es la **fuente
 * autoritativa** y no se duplica en código (sin riesgo de drift). El rol del actor sale de su
 * `membership` en el tenant de la petición (bajo RLS).
 *
 * La matriz global se cachea en memoria con TTL corto: es estática salvo nuevas migraciones de
 * seed, así que evitamos una consulta por request sin arriesgar quedar desincronizados.
 */
@Injectable()
export class PermisosService {
  private cache: { matriz: Map<string, Set<string>>; expira: number } | null = null;
  private readonly ttlMs = 60_000;

  constructor(private readonly database: DatabaseService) {}

  /** Matriz rol→permisos del catálogo global (cacheada). El catálogo no es tenant-scoped. */
  private async matrizPermisos(ahoraMs = Date.now()): Promise<Map<string, Set<string>>> {
    if (this.cache !== null && this.cache.expira > ahoraMs) {
      return this.cache.matriz;
    }
    const filas = await this.database.db
      .select({ rol: rolePermissions.roleCode, permiso: rolePermissions.permissionCode })
      .from(rolePermissions);
    const matriz = new Map<string, Set<string>>();
    for (const f of filas) {
      const set = matriz.get(f.rol) ?? new Set<string>();
      set.add(f.permiso);
      matriz.set(f.rol, set);
    }
    this.cache = { matriz, expira: ahoraMs + this.ttlMs };
    return matriz;
  }

  /** Permisos efectivos de un rol. */
  async permisosDeRol(rol: string): Promise<ReadonlySet<string>> {
    const matriz = await this.matrizPermisos();
    return matriz.get(rol) ?? new Set<string>();
  }

  /** Rol del actor en el tenant indicado, o `null` si no tiene membresía activa. */
  async rolDelActor(tenantId: string, userId: string): Promise<string | null> {
    return withTenant(
      this.database.db,
      async (tx) => {
        const [fila] = await tx
          .select({ role: memberships.role, status: memberships.status })
          .from(memberships)
          .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
          .limit(1);
        if (fila === undefined || fila.status !== 'active') {
          return null;
        }
        return fila.role;
      },
      tenantId,
    );
  }

  /** ¿El actor tiene el permiso requerido en su tenant? */
  async puede(tenantId: string, userId: string, permiso: string): Promise<boolean> {
    const rol = await this.rolDelActor(tenantId, userId);
    if (rol === null) {
      return false;
    }
    const permisos = await this.permisosDeRol(rol);
    return permisos.has(permiso);
  }

  /** Invalida la caché (útil tras administrar el catálogo o en tests). */
  invalidarCache(): void {
    this.cache = null;
  }
}
