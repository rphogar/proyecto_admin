/**
 * Cliente HTTP de autenticación (P28). Cubre el flujo real: login (+ 2º paso 2FA), refresh
 * rotativo, logout, listado de empresas del usuario y cambio de empresa, más el listado de empresas
 * (RIF) del tenant activo. Reemplaza al login demo (`/dev/sesion`) retirado en P28.
 */

import type { Compania, EmpresaMembresia } from './contexto-sesion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Par de tokens + empresa activa que devuelve el login y el cambio de empresa. */
export interface SesionEmitida {
  accessToken: string;
  refreshToken: string;
  expiraEnSeg: number;
  tenantActivo: string;
  empresas: EmpresaMembresia[];
}

/** Resultado del paso 1 del login: exige 2FA (reto) o ya entrega la sesión. */
export type ResultadoLogin =
  | { requiere2fa: true; reto: string }
  | ({ requiere2fa: false } & SesionEmitida);

/** Par de tokens del refresh (sin lista de empresas). */
export interface ParSesion {
  accessToken: string;
  refreshToken: string;
  expiraEnSeg: number;
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let detalle = `Error ${resp.status}`;
    try {
      const b = (await resp.json()) as { message?: unknown };
      if (b && typeof b.message === 'string') {
        detalle = b.message;
      }
    } catch {
      // sin cuerpo JSON
    }
    throw new Error(detalle);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

/** Paso 1 del login: email + password. */
export function login(email: string, password: string): Promise<ResultadoLogin> {
  return postJson<ResultadoLogin>('/auth/login', { email, password });
}

/** Paso 2 del login: canjea el reto 2FA con el código TOTP. */
export function login2fa(reto: string, codigo: string): Promise<SesionEmitida> {
  return postJson<SesionEmitida>('/auth/login/2fa', { reto, codigo });
}

/** Rota el refresh y emite un access nuevo (mismo tenant). */
export function refrescar(refreshToken: string): Promise<ParSesion> {
  return postJson<ParSesion>('/auth/refresh', { refreshToken });
}

/** Cierra la sesión en el servidor (revoca la familia del refresh). Idempotente. */
export function logout(refreshToken: string): Promise<void> {
  return postJson<void>('/auth/logout', { refreshToken });
}

/** Cambia la empresa/tenant activa: valida la membresía y re-emite una sesión acotada. */
export function cambiarEmpresa(token: string, tenantId: string): Promise<SesionEmitida> {
  return postJson<SesionEmitida>('/auth/cambiar-empresa', { tenantId }, token);
}

/** Empresas (tenants) del usuario autenticado, para el selector. */
export async function listarEmpresas(token: string): Promise<EmpresaMembresia[]> {
  const resp = await fetch(`${API_BASE}/auth/empresas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Error ${resp.status} al listar empresas`);
  }
  return resp.json() as Promise<EmpresaMembresia[]>;
}

/** Empresas (RIF) del tenant activo, para elegir/defaultear la empresa de trabajo. */
export async function listarCompanias(token: string): Promise<Compania[]> {
  const resp = await fetch(`${API_BASE}/maestros/companias`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Error ${resp.status} al listar empresas del tenant`);
  }
  return resp.json() as Promise<Compania[]>;
}
