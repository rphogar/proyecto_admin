import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { PermisosGuard } from './permisos.guard';
import type { PermisosService } from './permisos.service';

/**
 * Unit del guard RBAC con dependencias simuladas: la política real (catálogo en DB) se verifica
 * en el int spec; aquí se prueba la lógica del guard (sin permiso requerido pasa, sin actor 401,
 * permiso ausente 403 + auditoría, permiso presente pasa).
 */
describe('PermisosGuard', () => {
  let reflector: Reflector;
  let permisos: PermisosService;
  let audit: AuditService;
  let database: DatabaseService;
  let registrar: ReturnType<typeof vi.fn>;

  const ctxActor: TenantContext = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    ip: '10.0.0.1',
    device: 'jest',
  };

  function contextoConPermiso(permiso: string | undefined): ExecutionContext {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(permiso) } as unknown as Reflector;
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  function guard(): PermisosGuard {
    return new PermisosGuard(reflector, permisos, audit, database);
  }

  beforeEach(() => {
    registrar = vi.fn().mockResolvedValue(undefined);
    audit = { registrar } as unknown as AuditService;
    // withTenant ejecuta db.transaction(cb): simulamos invocando el callback con un tx que no hace IO.
    database = {
      db: { transaction: (cb: (tx: unknown) => unknown) => cb({ execute: vi.fn() }) },
    } as unknown as DatabaseService;
    permisos = {
      rolDelActor: vi.fn(),
      permisosDeRol: vi.fn(),
    } as unknown as PermisosService;
  });

  it('permite endpoints sin permiso declarado', async () => {
    const ctx = contextoConPermiso(undefined);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
  });

  it('rechaza con 401 si no hay actor identificado', async () => {
    const ctx = contextoConPermiso('document.issue');
    const sinUser: TenantContext = { ...ctxActor, userId: undefined };
    await expect(runWithTenantContext(sinUser, () => guard().canActivate(ctx))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('permite cuando el rol del actor tiene el permiso', async () => {
    const ctx = contextoConPermiso('document.issue');
    (permisos.rolDelActor as ReturnType<typeof vi.fn>).mockResolvedValue('cajero');
    (permisos.permisosDeRol as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Set(['document.issue', 'document.read']),
    );
    await expect(runWithTenantContext(ctxActor, () => guard().canActivate(ctx))).resolves.toBe(true);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('rechaza con 403 y audita cuando el rol no tiene el permiso (caso 54)', async () => {
    const ctx = contextoConPermiso('period.close');
    (permisos.rolDelActor as ReturnType<typeof vi.fn>).mockResolvedValue('cajero');
    (permisos.permisosDeRol as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Set(['document.issue', 'document.read']),
    );
    await expect(
      runWithTenantContext(ctxActor, () => guard().canActivate(ctx)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar.mock.calls[0]?.[1]).toMatchObject({
      accion: 'access.denied',
      after: { permiso: 'period.close', rol: 'cajero' },
    });
  });

  it('rechaza con 403 cuando el actor no tiene membresía en el tenant', async () => {
    const ctx = contextoConPermiso('document.read');
    (permisos.rolDelActor as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      runWithTenantContext(ctxActor, () => guard().canActivate(ctx)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(registrar).toHaveBeenCalledTimes(1);
  });
});
