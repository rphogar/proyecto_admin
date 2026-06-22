/**
 * Cliente HTTP de Compras y retenciones (P9): registro de facturas de compra con retención de
 * IVA/ISLR en el mismo flujo, comprobantes de retención (PDF/TXT) y comprobantes recibidos. Reusa
 * `ApiError` de los maestros para preservar el cuerpo del error.
 */
import { cabecerasAuth } from './contexto-sesion';
import { ApiError } from './maestros-api';
import type { AlicuotaCodigo, LineaBorradorInput } from './ventas-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...cabecerasAuth(), ...(init?.headers ?? {}) },
  });
  if (!resp.ok) {
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
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export type { AlicuotaCodigo, LineaBorradorInput };

export interface CompraInput {
  companyId: string;
  partyId: string;
  tipoDocumento?: 'FACTURA' | 'NOTA_DEBITO' | 'NOTA_CREDITO';
  numeroDocumento: string;
  numeroControl: string;
  numeroDocumentoAfectado?: string | null;
  cuentaDestino?: string;
  fechaDocumento?: string;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  forzarRetencion100?: boolean;
  conceptoIslr?: string | null;
  tarifaIslr?: string | null;
  sustraendoIslr?: string | null;
  baseIslr?: string | null;
  lineas: LineaBorradorInput[];
}

export interface Compra {
  id: string;
  partyId: string;
  proveedorRif: string;
  proveedorNombre: string;
  tipoDocumento: string;
  numeroDocumento: string;
  numeroControl: string;
  currency: string;
  fechaFiscal: string;
  baseVes: string | null;
  ivaVes: string | null;
  totalVes: string | null;
  retencionIvaVes: string | null;
  retencionIslrVes: string | null;
  status: string;
}

export interface RetencionEmitida {
  id: string;
  tipo: 'IVA' | 'ISLR';
  numeroComprobante: string;
  baseVes: string;
  porcentaje: string;
  montoVes: string;
  conceptoIslr: string | null;
}

export interface CompraRegistrada {
  compra: Compra;
  retenciones: RetencionEmitida[];
}

export interface RetencionRecibidaInput {
  companyId: string;
  partyId: string;
  documentId?: string | null;
  tipo: 'IVA' | 'ISLR';
  numeroComprobante: string;
  conceptoIslr?: string | null;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  baseOrigen: string;
  porcentaje: string;
  montoOrigen: string;
  fechaComprobante?: string | undefined;
  fechaRecepcion?: string | undefined;
}

export const comprasApi = {
  registrar: (body: CompraInput): Promise<CompraRegistrada> =>
    req('/compras', { method: 'POST', body: JSON.stringify(body) }),
  listar: (companyId: string): Promise<Compra[]> => req(`/compras?companyId=${encodeURIComponent(companyId)}`),
  registrarRecibida: (body: RetencionRecibidaInput): Promise<unknown> =>
    req('/compras/retenciones-recibidas', { method: 'POST', body: JSON.stringify(body) }),
  listarRecibidas: (companyId: string): Promise<unknown[]> =>
    req(`/compras/retenciones-recibidas?companyId=${encodeURIComponent(companyId)}`),
  comprobantePdfUrl: (id: string): string => `${API_BASE}/compras/retenciones/${id}/pdf`,
  comprobanteTxtUrl: (id: string): string => `${API_BASE}/compras/retenciones/${id}/txt`,
};
