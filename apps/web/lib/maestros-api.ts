/**
 * Cliente HTTP de los maestros (P5). Funciones tipadas sobre los endpoints `/maestros/*` de la API.
 * El manejo de error preserva el cuerpo JSON (p.ej. `motivo` del RIF inválido, caso 16) para que la
 * UI lo muestre.
 */

import { cabecerasTenant } from './contexto-sesion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Error de la API con el cuerpo JSON adjunto (si lo hubo). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

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

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...cabecerasTenant(), ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
    return parseError(resp);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

/** Cliente CRUD para un maestro company-scoped. */
export function recurso<Fila extends { id: string }>(nombre: string) {
  const base = `/maestros/${nombre}`;
  return {
    listar: (companyId: string): Promise<Fila[]> =>
      req<Fila[]>(`${base}?companyId=${encodeURIComponent(companyId)}`),
    crear: (body: Record<string, unknown>): Promise<Fila> =>
      req<Fila>(base, { method: 'POST', body: JSON.stringify(body) }),
    actualizar: (id: string, body: Record<string, unknown>): Promise<Fila> =>
      req<Fila>(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    eliminar: (id: string): Promise<void> => req<void>(`${base}/${id}`, { method: 'DELETE' }),
  };
}

// ── Tipos de fila (espejo de los $inferSelect de la API) ──────────────────────

export interface Party {
  id: string;
  tipo: 'cliente' | 'proveedor' | 'ambos';
  rif: string;
  razonSocial: string;
  condicionIva: 'ordinario' | 'formal' | 'especial' | 'no_contribuyente';
  esAgenteRetencionIva: boolean;
  pctRetencionIva: string | null;
  esAgenteRetencionIslr: boolean;
  direccionFiscal: string | null;
  email: string | null;
  telefono: string | null;
  limiteCredito: string | null;
  diasCredito: number;
  activo: boolean;
}

export interface Item {
  id: string;
  sku: string;
  descripcion: string;
  tipo: 'producto' | 'servicio';
  alicuotaIva: 'GENERAL' | 'REDUCIDA' | 'ADICIONAL' | 'EXENTO' | 'EXONERADO' | 'EXPORTACION';
  unidad: string;
  controlLote: boolean;
  controlSerial: boolean;
  activo: boolean;
}

export interface PriceList {
  id: string;
  codigo: string;
  nombre: string;
  moneda: 'VES' | 'USD' | 'EUR';
  esDefault: boolean;
  activo: boolean;
}

export interface Warehouse {
  id: string;
  branchId: string | null;
  codigo: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
}

export interface PaymentMethod {
  id: string;
  codigo: string;
  nombre: string;
  moneda: 'VES' | 'USD' | 'EUR';
  cuentaId: string;
  causaIgtf: boolean;
  activo: boolean;
}

export interface Serie {
  id: string;
  branchId: string | null;
  docType: string;
  prefijo: string;
  nextNumber: number;
  activo: boolean;
}

export const partiesApi = recurso<Party>('parties');
export const itemsApi = recurso<Item>('items');
export const priceListsApi = recurso<PriceList>('price-lists');
export const warehousesApi = recurso<Warehouse>('warehouses');
export const paymentMethodsApi = recurso<PaymentMethod>('payment-methods');
export const seriesApi = recurso<Serie>('series');
