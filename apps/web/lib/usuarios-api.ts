/**
 * Cliente HTTP de gestión de usuarios (P29, docs/06 M12). Endpoints `/usuarios/*` (autenticados, el
 * tenant/actor salen del Bearer) para administrar miembros, roles, invitaciones y separación de
 * deberes; más los endpoints públicos `/invitaciones/*` (PRE-tenant) para aceptar una invitación.
 */

import { cabecerasAuth } from './contexto-sesion';
import { ApiError } from './maestros-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function parseError(resp: Response): Promise<never> {
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    body = undefined;
  }
  const msg =
    body && typeof body === 'object' && 'message' in body
      ? String((body as { message: unknown }).message)
      : `Error ${resp.status}`;
  throw new ApiError(resp.status, msg, body);
}

async function req<T>(path: string, init?: RequestInit, conAuth = true): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(conAuth ? cabecerasAuth() : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    return parseError(resp);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

export interface Miembro {
  membershipId: string;
  userId: string;
  email: string;
  nombre: string;
  rol: string;
  status: string;
  createdAt: string;
}

export interface Invitacion {
  id: string;
  email: string;
  rol: string;
  estado: string;
  expiresAt: string;
  createdAt: string;
}

export interface CatalogoRbac {
  roles: { code: string; descripcion: string }[];
  permisos: { code: string; descripcion: string }[];
  matriz: Record<string, string[]>;
}

export interface ReglaSegregacion {
  regla: string;
  descripcion: string;
  activo: boolean;
}

/** Roles asignables por la UI (owner se concede solo por transferencia de propiedad). */
export const ROLES_ASIGNABLES = ['admin', 'contador', 'cajero', 'vendedor', 'auditor'] as const;

export const usuariosApi = {
  listar: (): Promise<Miembro[]> => req('/usuarios'),
  invitaciones: (): Promise<Invitacion[]> => req('/usuarios/invitaciones'),
  roles: (): Promise<CatalogoRbac> => req('/usuarios/roles'),
  segregacion: (): Promise<ReglaSegregacion[]> => req('/usuarios/segregacion'),

  invitar: (email: string, rol: string): Promise<{ invitationId: string; tokenDev?: string }> =>
    req('/usuarios/invitar', { method: 'POST', body: JSON.stringify({ email, rol }) }),
  revocarInvitacion: (id: string): Promise<void> =>
    req(`/usuarios/invitaciones/${id}/revocar`, { method: 'POST' }),
  reasignarRol: (membershipId: string, rol: string): Promise<void> =>
    req(`/usuarios/${membershipId}/rol`, { method: 'PATCH', body: JSON.stringify({ rol }) }),
  desactivar: (membershipId: string): Promise<void> =>
    req(`/usuarios/${membershipId}/desactivar`, { method: 'POST' }),
  reactivar: (membershipId: string): Promise<void> =>
    req(`/usuarios/${membershipId}/reactivar`, { method: 'POST' }),
  transferirPropiedad: (membershipId: string): Promise<void> =>
    req('/usuarios/transferir-propiedad', {
      method: 'POST',
      body: JSON.stringify({ membershipId }),
    }),
  configurarSegregacion: (regla: string, activo: boolean): Promise<void> =>
    req('/usuarios/segregacion', { method: 'PATCH', body: JSON.stringify({ regla, activo }) }),
};

// ── Aceptación pública (sin sesión) ─────────────────────────────────────────────

export interface PeekInvitacion {
  email: string;
  rol: string;
  empresa: string;
  requiereRegistro: boolean;
}

export const invitacionPublicaApi = {
  peek: (token: string): Promise<PeekInvitacion> =>
    req(`/invitaciones/${encodeURIComponent(token)}`, undefined, false),
  aceptar: (
    token: string,
    datos: { nombre?: string; password?: string },
  ): Promise<{ tenantId: string; rol: string }> =>
    req('/invitaciones/aceptar', { method: 'POST', body: JSON.stringify({ token, ...datos }) }, false),
};
