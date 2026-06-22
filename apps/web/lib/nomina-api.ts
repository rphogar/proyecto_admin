/**
 * Cliente HTTP de Nómina (P15, doc 06 M8): fichas, conceptos con fórmulas seguras, corridas
 * (pre-nómina→aprobación→contabilización), recibos PDF, kardex de prestaciones y liquidación
 * (art. 142), provisiones, parafiscales con planillas y ARI/ARC. Reusa `ApiError` de los maestros.
 */
import { cabecerasAuth } from './contexto-sesion';
import { ApiError } from './maestros-api';

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
    const msg = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : `Error ${resp.status}`;
    throw new ApiError(resp.status, msg, body);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

// ── Tipos (espejo de la API) ──────────────────────────────────────────────────

export interface Trabajador {
  id: string;
  cedula: string;
  nombre: string;
  cargo: string | null;
  fechaIngreso: string;
  fechaEgreso: string | null;
  frecuenciaPago: string;
  salarioNormalMensual: string;
  salarioMonedaExtra: string | null;
  salarioMontoExtra: string | null;
  ariPorcentaje: string;
  activo: boolean;
}

export interface Concepto {
  id: string;
  codigo: string;
  nombre: string;
  tipo: 'ASIGNACION' | 'DEDUCCION';
  formula: string;
  salarial: boolean;
  orden: number;
  activo: boolean;
}

export interface ReciboLinea {
  id: string;
  conceptoCodigo: string;
  nombre: string;
  tipo: 'ASIGNACION' | 'DEDUCCION';
  montoVes: string;
  montoUsdMgmt: string;
}
export interface Recibo {
  id: string;
  trabajadorId: string;
  diasEfectivos: string;
  totalAsignaciones: string;
  totalDeducciones: string;
  neto: string;
  netoUsd: string | null;
  lineas: ReciboLinea[];
}
export interface Corrida {
  id: string;
  anio: number;
  mes: number;
  periodoEtiqueta: string;
  frecuencia: string;
  estado: 'BORRADOR' | 'APROBADA' | 'CONTABILIZADA';
  totalAsignaciones: string;
  totalDeducciones: string;
  totalNeto: string;
  journalEntryId: string | null;
}
export interface CorridaConRecibos {
  corrida: Corrida;
  recibos: Recibo[];
}

export interface MovimientoKardex {
  id: string;
  trabajadorId: string;
  fecha: string;
  tipo: string;
  montoVes: string;
  saldoGarantiaVes: string | null;
  nota: string | null;
}
export interface ResultadoLiquidacion {
  calculo: {
    viaGarantia: string;
    viaRetroactiva: string;
    baseMayor: 'GARANTIA' | 'RETROACTIVA';
    prestaciones: string;
    prestacionesACancelar: string;
    indemnizacionArt92: string;
    totalAPagar: string;
  };
  movimiento: MovimientoKardex;
}

export interface Parafiscal {
  id: string;
  regimen: 'IVSS' | 'RPE' | 'FAOV' | 'INCES';
  baseVes: string;
  montoTrabajadorVes: string;
  montoPatronoVes: string;
  semanasCotizables: number | null;
  estadoPlanilla: string;
}

export interface Provision {
  id: string;
  trabajadorId: string;
  utilidades: string;
  vacaciones: string;
  bonoVacacional: string;
  prestaciones: string;
  intereses: string;
  total: string;
}

function descargar(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const nominaApi = {
  // Trabajadores
  listarTrabajadores: (companyId: string) => req<Trabajador[]>(`/nomina/trabajadores?companyId=${companyId}`),
  crearTrabajador: (body: Record<string, unknown>) => req<Trabajador>('/nomina/trabajadores', { method: 'POST', body: JSON.stringify(body) }),

  // Conceptos
  listarConceptos: (companyId: string) => req<Concepto[]>(`/nomina/conceptos?companyId=${companyId}`),
  validarConcepto: (body: { formula: string }) => req<{ valida: boolean; errores: string[] }>('/nomina/conceptos/validar', { method: 'POST', body: JSON.stringify(body) }),
  crearConcepto: (body: Record<string, unknown>) => req<Concepto>('/nomina/conceptos', { method: 'POST', body: JSON.stringify(body) }),

  // Corridas
  listarCorridas: (companyId: string) => req<Corrida[]>(`/nomina/corridas?companyId=${companyId}`),
  detalleCorrida: (companyId: string, id: string) => req<CorridaConRecibos>(`/nomina/corridas/detalle?companyId=${companyId}&id=${id}`),
  crearCorrida: (body: Record<string, unknown>) => req<CorridaConRecibos>('/nomina/corridas', { method: 'POST', body: JSON.stringify(body) }),
  aprobarCorrida: (body: { companyId: string; id: string }) => req<Corrida>('/nomina/corridas/aprobar', { method: 'POST', body: JSON.stringify(body) }),
  contabilizarCorrida: (body: { companyId: string; id: string }) => req<Corrida>('/nomina/corridas/contabilizar', { method: 'POST', body: JSON.stringify(body) }),
  reciboPdfUrl: (companyId: string, id: string) => `${API_BASE}/nomina/recibos/pdf?companyId=${companyId}&id=${id}`,

  // Prestaciones
  kardex: (companyId: string, trabajadorId: string) => req<MovimientoKardex[]>(`/nomina/prestaciones/kardex?companyId=${companyId}&trabajadorId=${trabajadorId}`),
  registrarMovimiento: (body: Record<string, unknown>) => req<MovimientoKardex>('/nomina/prestaciones/movimiento', { method: 'POST', body: JSON.stringify(body) }),
  liquidar: (body: Record<string, unknown>) => req<ResultadoLiquidacion>('/nomina/prestaciones/liquidar', { method: 'POST', body: JSON.stringify(body) }),

  // Provisiones
  listarProvisiones: (companyId: string, anio: number, mes: number) => req<Provision[]>(`/nomina/provisiones?companyId=${companyId}&anio=${anio}&mes=${mes}`),
  generarProvisiones: (body: Record<string, unknown>) => req<{ provisiones: Provision[]; journalEntryId: string }>('/nomina/provisiones', { method: 'POST', body: JSON.stringify(body) }),

  // Parafiscales
  listarParafiscales: (companyId: string, anio: number, mes: number) => req<Parafiscal[]>(`/nomina/parafiscales?companyId=${companyId}&anio=${anio}&mes=${mes}`),
  calcularParafiscales: (body: Record<string, unknown>) => req<Parafiscal[]>('/nomina/parafiscales/calcular', { method: 'POST', body: JSON.stringify(body) }),
  descargarPlanilla: async (body: { companyId: string; anio: number; mes: number; regimen: string }) => {
    const resp = await fetch(`${API_BASE}/nomina/parafiscales/planilla`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabecerasAuth() }, body: JSON.stringify(body) });
    if (!resp.ok) throw new ApiError(resp.status, `Error ${resp.status}`, undefined);
    const cd = resp.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(cd);
    descargar(await resp.blob(), match?.[1] ?? `planilla-${body.regimen}.txt`);
  },

  // ARI / ARC
  setAri: (body: Record<string, unknown>) => req('/nomina/ari', { method: 'POST', body: JSON.stringify(body) }),
  emitirArc: (body: Record<string, unknown>) => req('/nomina/arc', { method: 'POST', body: JSON.stringify(body) }),
};
