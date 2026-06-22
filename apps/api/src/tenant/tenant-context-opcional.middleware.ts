import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenantContext, type TenantContext } from './tenant-context';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Variante LENIENTE del contexto de tenant para rutas de lectura pública que solo tocan datos
 * globales (p. ej. `GET /tasas/dia`: la tasa BCV es global, `tenant_id = NULL`). Si llega una
 * cabecera `x-tenant-id` válida abre el contexto (para que un tenant logueado vea también su
 * tasa MANUAL propia, caso 57); si no llega, deja pasar SIN contexto (la página pública de la
 * landing muestra la tasa sin sesión). A diferencia del middleware estricto, no lanza 400.
 *
 * TODO(auth): cuando exista login/JWT, derivar el contexto del token cuando esté presente.
 */
@Injectable()
export class TenantContextOpcionalMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const rawTenant = req.header('x-tenant-id');
    if (rawTenant === undefined || !UUID_RE.test(rawTenant)) {
      next();
      return;
    }

    const rawUser = req.header('x-user-id');
    const userId = rawUser !== undefined && UUID_RE.test(rawUser) ? rawUser.toLowerCase() : undefined;

    const ctx: TenantContext = {
      tenantId: rawTenant.toLowerCase(),
      userId,
      ip: req.ip ?? undefined,
      device: req.header('user-agent') ?? undefined,
    };

    runWithTenantContext(ctx, () => {
      next();
    });
  }
}
