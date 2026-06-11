import { BadRequestException, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenantContext, type TenantContext } from './tenant-context';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Abre el contexto de tenant para la petición a partir de la cabecera `x-tenant-id`.
 *
 * STUB de P2: el tenant (y el actor) se toman de cabeceras. En la fase de auth esto se
 * reemplaza por el claim del JWT verificado.
 * TODO(auth): derivar tenantId/userId del token, no de cabeceras del cliente.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const rawTenant = req.header('x-tenant-id');
    if (rawTenant === undefined || !UUID_RE.test(rawTenant)) {
      throw new BadRequestException('Cabecera x-tenant-id ausente o no es un UUID válido.');
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
