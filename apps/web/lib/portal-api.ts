/**
 * Cliente HTTP del Portal del contador (P16, docs/06 M11). Vista tenant-level de la cartera de
 * empresas: panel multi-empresa con estado de cierres, calendario consolidado de obligaciones,
 * checklist masivo de cierre y delegaciones de permisos por empresa. Reusa `ApiError` de los maestros.
 */
import { ApiError } from './maestros-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      body = undefined;
    }
    const msg = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : `Error ${resp.status}`;
    throw new ApiError(resp.status, msg, body);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

// ── Tipos (espejo de la API) ────────────────────────────────────────────────────

export type EstadoCierreActual = 'OPEN' | 'CLOSED' | 'REABIERTO' | 'SIN_PERIODO';

export interface ObligacionPortal {
  companyId: string;
  rif: string;
  razonSocial: string;
  tipo: 'IVA' | 'IGTF';
  periodo: string;
  fechaLimite: string;
  diasRestantes: number;
  estado: 'PRESENTADA' | 'PENDIENTE';
}

export interface EmpresaPanel {
  companyId: string;
  rif: string;
  razonSocial: string;
  tipoContribuyente: string;
  spe: boolean;
  cierre: {
    ultimoCerrado: string | null;
    periodosAbiertos: number;
    periodoActual: string;
    estadoActual: EstadoCierreActual;
  };
  obligaciones: { pendientes: number; vencidas: number; proxima: ObligacionPortal | null };
}

export interface PanelDto {
  fecha: string;
  periodoActual: string;
  empresas: EmpresaPanel[];
  totales: { empresas: number; obligacionesPendientes: number; obligacionesVencidas: number; cierresPendientes: number };
}

export interface CalendarioDto {
  fecha: string;
  obligaciones: ObligacionPortal[];
}

export interface PasoCierre {
  paso: number;
  clave: string;
  estado: 'OK' | 'PENDIENTE' | 'NO_APLICA' | 'OMITIDO_TODO';
  bloqueante: boolean;
  detalle: string;
}

export interface ChecklistEmpresa {
  companyId: string;
  rif: string;
  razonSocial: string;
  yaCerrado: boolean;
  puedeCerrar: boolean;
  pasos: PasoCierre[];
}

export interface ChecklistMasivoDto {
  anio: number;
  mes: number;
  empresas: ChecklistEmpresa[];
  totales: { empresas: number; listas: number; cerradas: number };
}

export interface Delegacion {
  id: string;
  companyId: string;
  userId: string;
  permisos: string[];
  estado: 'ACTIVA' | 'REVOCADA';
  otorgadoPor: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const portalApi = {
  panel: () => req<PanelDto>('/portal/panel'),
  calendario: () => req<CalendarioDto>('/portal/calendario'),
  checklist: (anio: number, mes: number) => req<ChecklistMasivoDto>(`/portal/checklist?anio=${anio}&mes=${mes}`),
  listarDelegaciones: (companyId?: string) =>
    req<Delegacion[]>(`/portal/delegaciones${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`),
  otorgar: (body: { companyId: string; userId: string; permisos: string[] }) =>
    req<Delegacion>('/portal/delegaciones', { method: 'POST', body: JSON.stringify(body) }),
  revocar: (id: string) => req<Delegacion>('/portal/delegaciones/revocar', { method: 'POST', body: JSON.stringify({ id }) }),
};
