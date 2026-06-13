/**
 * Cliente HTTP de Ventas (P8): documentos (factura/NC/ND, borradores, cálculo en vivo, PDF) y
 * cobros. Reusa `ApiError` de los maestros para preservar el cuerpo del error (p.ej. los
 * `incumplimientos` del validador 00071/00102 o el exceso de saldo de una NC).
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
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Error ${resp.status}`;
    throw new ApiError(resp.status, msg, body);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

// ── Tipos (espejo de la API) ──────────────────────────────────────────────────

export type AlicuotaCodigo = 'GENERAL' | 'REDUCIDA' | 'ADICIONAL' | 'EXENTO' | 'EXONERADO' | 'EXPORTACION';

export interface LineaBorradorInput {
  itemId?: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitarioOrigen: string;
  descuentoOrigen?: string | null;
  alicuotaCodigo: AlicuotaCodigo;
  alicuotaTasa: string;
}

export interface DocumentoInput {
  companyId: string;
  seriesId: string;
  tipo: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  branchId?: string | null;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  medioEmision?: string;
  numeroControl?: string | null;
  paymentCondition: 'CONTADO' | 'CREDITO';
  issueDate?: string;
  partyId?: string | null;
  adquirenteRif?: string | null;
  adquirenteNombre?: string | null;
  affectedDocumentId?: string | null;
  umbralConsumidorFinalVes?: string | null;
  /** Para el IGTF estimado del panel en vivo. */
  pagosEstimados?: { moneda: string; montoOrigen: string; esDivisa: boolean; rateBcv: string | null }[];
  empresaEsPerceptor?: boolean;
  lineas: LineaBorradorInput[];
}

export interface ImpuestoCalculado {
  alicuotaCodigo: AlicuotaCodigo;
  alicuotaTasa: string;
  baseOrigen: string;
  baseVes: string;
  baseUsdMgmt: string;
  montoOrigen: string;
  montoVes: string;
  montoUsdMgmt: string;
}

export interface Incumplimiento {
  codigo: string;
  campo: string;
  mensaje: string;
  norma: string;
}

export interface ResultadoCalculo {
  calculo: {
    lineas: unknown[];
    impuestos: ImpuestoCalculado[];
    totales: { totalOrigen: string; totalVes: string; totalUsdMgmt: string };
  };
  incumplimientos: Incumplimiento[];
  igtfEstimadoVes: string | null;
}

export interface Documento {
  id: string;
  type: string;
  number: number | null;
  controlNumber: string | null;
  status: 'DRAFT' | 'ISSUED' | 'CANCELLED' | 'APPLIED';
  currency: string;
  rateBcv: string | null;
  rateUsdMgmt: string | null;
  partyNombre: string | null;
  partyRif: string | null;
  paymentCondition: string | null;
  issueFechaFiscal: string;
  totalOrigen: string | null;
  totalVes: string | null;
  totalUsdMgmt: string | null;
  affectedDocumentId: string | null;
}

export interface DocumentoConDetalle {
  documento: Documento;
  lineas: (LineaBorradorInput & { id: string; lineaNo: number })[];
  impuestos: ImpuestoCalculado[];
}

export interface CobroInput {
  companyId: string;
  documentId: string;
  fecha?: string;
  rateUsdMgmt: string;
  medios: { paymentMethodId: string; montoOrigen: string; rateBcv: string | null }[];
  vuelto?: { paymentMethodId: string; montoOrigen: string; rateBcv: string | null }[];
}

export const documentosApi = {
  calcular: (body: DocumentoInput): Promise<ResultadoCalculo> =>
    req('/documentos/calcular', { method: 'POST', body: JSON.stringify(body) }),
  listar: (companyId: string, type?: string, status?: string): Promise<Documento[]> => {
    const q = new URLSearchParams({ companyId });
    if (type) q.set('type', type);
    if (status) q.set('status', status);
    return req(`/documentos?${q.toString()}`);
  },
  obtener: (id: string): Promise<DocumentoConDetalle> => req(`/documentos/${id}`),
  crearBorrador: (body: DocumentoInput): Promise<DocumentoConDetalle> =>
    req('/documentos', { method: 'POST', body: JSON.stringify(body) }),
  actualizarBorrador: (id: string, body: DocumentoInput): Promise<DocumentoConDetalle> =>
    req(`/documentos/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  emitir: (body: DocumentoInput): Promise<{ documento: Documento }> =>
    req('/documentos/emitir', { method: 'POST', body: JSON.stringify(body) }),
  emitirBorrador: (id: string): Promise<{ documento: Documento }> =>
    req(`/documentos/${id}/emitir`, { method: 'POST' }),
  eliminar: (id: string): Promise<void> => req(`/documentos/${id}`, { method: 'DELETE' }),
  pdfUrl: (id: string): string => `${API_BASE}/documentos/${id}/pdf`,
};

export const cobrosApi = {
  registrar: (body: CobroInput): Promise<unknown> => req('/cobros', { method: 'POST', body: JSON.stringify(body) }),
  listar: (companyId: string): Promise<unknown[]> => req(`/cobros?companyId=${encodeURIComponent(companyId)}`),
};
