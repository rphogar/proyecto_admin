import { Injectable, type NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { claveJwt, verificarJwt } from '../seguridad/jwt';
import { runWithTenantContext, type TenantContext } from './tenant-context';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Lee el access JWT del `Authorization: Bearer`, lo verifica y devuelve `{ tenantId, userId }` o
 * `null` si falta/!verifica/no es un `access` con `tid` válido. Es el ÚNICO origen del contexto de
 * tenant (P28): ni el tenant ni el actor salen de cabeceras del cliente. El `tid` va firmado
 * (HS256): alterarlo invalida la firma, por lo que no se puede forzar un tenant.
 */
export function contextoDesdeBearer(req: Request): { tenantId: string; userId: string } | null {
  const cabecera = req.header('authorization') ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice('Bearer '.length).trim() : '';
  if (token === '') {
    return null;
  }
  const claims = verificarJwt(token, claveJwt());
  if (
    claims === null ||
    claims.scope !== 'access' ||
    typeof claims.tid !== 'string' ||
    !UUID_RE.test(claims.tid) ||
    !UUID_RE.test(claims.sub)
  ) {
    return null;
  }
  return { tenantId: claims.tid.toLowerCase(), userId: claims.sub.toLowerCase() };
}

/**
 * Abre el contexto de tenant para la petición a partir del JWT de sesión verificado (P28). El
 * tenant (`app.tenant_id` vía `withTenant`) y el actor (auditoría) se derivan SIEMPRE del token
 * firmado, NUNCA de datos del cliente. Sin un Bearer válido → 401.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const derivado = contextoDesdeBearer(req);
    if (derivado === null) {
      throw new UnauthorizedException({
        codigo: 'TOKEN_INVALIDO',
        message: 'Se requiere una sesión válida (Authorization: Bearer).',
      });
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
