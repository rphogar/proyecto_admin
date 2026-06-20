import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import { getTenantContext } from '../tenant/tenant-context';
import { LimitadorVentanaDeslizante, type OpcionesLimitador } from './rate-limit';

export const RATE_LIMIT_METADATA = 'contave:rate_limit';

/**
 * Configura el límite de tasa de un endpoint. La clave del cubo combina actor (o IP) + nombre,
 * de modo que un endpoint sensible (login, emisión) se limita por separado del resto.
 *
 * @example @RateLimit({ nombre: 'login', limite: 5, ventanaMs: 60_000 })
 */
export const RateLimit = (
  opts: OpcionesLimitador & { nombre: string },
): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_METADATA, opts);

/**
 * Guard de rate limiting (docs/05 §6). Mantiene un limitador de ventana deslizante por
 * configuración (`nombre`) y cuenta por actor autenticado o, en su defecto, por IP. Al exceder el
 * cupo responde **429** con `Retry-After`. El estado vive en memoria del proceso; en multi-instancia
 * el backend se sustituye por Redis conservando `LimitadorVentanaDeslizante`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limitadores = new Map<string, LimitadorVentanaDeslizante>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const cfg = this.reflector.getAllAndOverride<
      (OpcionesLimitador & { nombre: string }) | undefined
    >(RATE_LIMIT_METADATA, [context.getHandler(), context.getClass()]);
    if (cfg === undefined) {
      return true;
    }

    const limitador = this.limitadorPara(cfg);
    const clave = `${cfg.nombre}:${this.identidad(context)}`;
    const resultado = limitador.consumir(clave, Date.now());
    if (!resultado.permitido) {
      const res = context.switchToHttp().getResponse<Response>();
      res.setHeader('Retry-After', Math.ceil(resultado.reintentarEnMs / 1000));
      throw new HttpException(
        { codigo: 'RATE_LIMIT_EXCEDIDO', message: 'Demasiadas solicitudes; reintentá más tarde' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private limitadorPara(cfg: OpcionesLimitador & { nombre: string }): LimitadorVentanaDeslizante {
    let lim = this.limitadores.get(cfg.nombre);
    if (lim === undefined) {
      lim = new LimitadorVentanaDeslizante(cfg);
      this.limitadores.set(cfg.nombre, lim);
    }
    return lim;
  }

  /** Identidad del solicitante: actor autenticado si lo hay, si no la IP de la petición. */
  private identidad(context: ExecutionContext): string {
    const ctx = getTenantContext();
    if (ctx?.userId !== undefined) {
      return `user:${ctx.userId}`;
    }
    const req = context.switchToHttp().getRequest<Request>();
    return `ip:${req.ip ?? 'desconocida'}`;
  }
}
