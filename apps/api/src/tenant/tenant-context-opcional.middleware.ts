import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { contextoDesdeBearer } from './tenant-context.middleware';
import { runWithTenantContext, type TenantContext } from './tenant-context';

/**
 * Variante LENIENTE del contexto de tenant para rutas de lectura pública que solo tocan datos
 * globales (p. ej. `GET /tasas/dia`: la tasa BCV es global, `tenant_id = NULL`). Si llega un
 * `Authorization: Bearer` válido, abre el contexto (para que un tenant logueado vea también su
 * tasa MANUAL propia, caso 57); si no, deja pasar SIN contexto (la landing pública muestra la tasa
 * sin sesión). A diferencia del middleware estricto, no lanza 401.
 */
@Injectable()
export class TenantContextOpcionalMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const derivado = contextoDesdeBearer(req);
    if (derivado === null) {
      next();
      return;
    }

    const ctx: TenantContext = {
      tenantId: derivado.tenantId,
      userId: derivado.userId,
      ip: req.ip ?? undefined,
      device: req.header('user-agent') ?? undefined,
    };

    runWithTenantContext(ctx, () => {
      next();
    });
  }
}
