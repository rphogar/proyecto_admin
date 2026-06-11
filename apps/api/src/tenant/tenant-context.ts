import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de la petición en curso. `tenantId` es obligatorio (sin él no hay acceso a datos);
 * el resto identifica al actor para la auditoría (regla 5 de CLAUDE.md). Los campos
 * contextuales se tipan como `string | undefined` (no opcionales) para asignar `undefined`
 * explícito bajo `exactOptionalPropertyTypes`.
 */
export interface TenantContext {
  tenantId: string;
  userId: string | undefined;
  ip: string | undefined;
  device: string | undefined;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Ejecuta `fn` con el contexto de tenant activo (lo abre el middleware por request). */
export function runWithTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Contexto actual o `undefined` si se llama fuera de una petición con contexto. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** Contexto actual; lanza si no hay (uso indebido: acceso a datos sin tenant). */
export function requireTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (ctx === undefined) {
    throw new Error('No hay contexto de tenant en la petición actual.');
  }
  return ctx;
}
