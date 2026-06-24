/**
 * Cliente HTTP del asistente de alta de empresa (P30). Funciones tipadas sobre `/onboarding/*`.
 * Conserva el cuerpo JSON del error (p.ej. `motivo` del RIF inválido, caso 16) para mostrarlo en el
 * wizard. Reusa el `Authorization: Bearer` de la sesión real (P28).
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
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Error ${resp.status}`;
    throw new ApiError(resp.status, msg, body);
  }
  return resp.json() as Promise<T>;
}

export type TipoContribuyente = 'ORDINARIO' | 'FORMAL' | 'ESPECIAL';
export type FormaJuridica = 'PN' | 'PJ';

export interface PerfilInferido {
  tipoContribuyente: TipoContribuyente;
  esSpe: boolean;
  cobraIva: boolean;
  periodicidadIva: 'MENSUAL' | 'CALENDARIO_SPE';
  esAgenteRetencionIva: boolean;
  esAgenteRetencionIslr: boolean;
  percibeIgtf: boolean;
  excluidoAjusteInflacion: boolean;
  alicuotaIslrPj: number | null;
  pctRetencionQueLeAplican: 75 | 100 | null;
  ejercicioFiscalInicio: number;
  riesgoIvss: 'minimo' | 'medio' | 'maximo' | null;
  diasUtilidades: number | null;
  seriesRetencion: string[];
}

export interface DatosEmpresaInput {
  rif: string;
  razonSocial: string;
  direccionFiscal?: string;
  tipoContribuyente: TipoContribuyente;
  formaJuridica: FormaJuridica;
  esAgenteRetencionIslr?: boolean;
  pctRetencionQueLeAplican?: 75 | 100 | null;
  ejercicioFiscalInicio?: number;
  riesgoIvss?: 'minimo' | 'medio' | 'maximo' | null;
  diasUtilidades?: number | null;
}

export interface ResultadoInferencia {
  rifValido: boolean;
  rifNormalizado: string;
  perfil: PerfilInferido;
}

export interface ResultadoPrecarga {
  cuentas: number;
  almacenes: number;
  metodosPago: number;
  series: number;
  plantillas: number;
  periodos: number;
}

export interface ResultadoCrearEmpresa {
  companyId: string;
  creada: boolean;
  perfil: PerfilInferido;
  precarga: ResultadoPrecarga;
}

export interface RenglonAperturaInput {
  naturaleza: 'ACTIVO' | 'PASIVO';
  cuenta: string;
  moneda: string;
  montoOrigen: string;
  rateBcv?: string | null;
  partyId?: string;
  vencimiento?: string;
  itemId?: string;
  warehouseId?: string;
  cantidad?: string;
  fechaOrigen?: string;
}

export interface SaldosInicialesInput {
  fechaApertura: string;
  capitalVes: string;
  rateUsdMgmt: string;
  renglones: RenglonAperturaInput[];
}

export interface ResultadoApertura {
  aperturaId: string;
  journalEntryId: string;
  creada: boolean;
}

export const onboardingApi = {
  inferirPerfil: (body: DatosEmpresaInput): Promise<ResultadoInferencia> =>
    req('/onboarding/inferir-perfil', { method: 'POST', body: JSON.stringify(body) }),
  crearEmpresa: (body: DatosEmpresaInput): Promise<ResultadoCrearEmpresa> =>
    req('/onboarding/empresas', { method: 'POST', body: JSON.stringify(body) }),
  registrarSaldos: (companyId: string, body: SaldosInicialesInput): Promise<ResultadoApertura> =>
    req(`/onboarding/empresas/${companyId}/saldos-iniciales`, { method: 'POST', body: JSON.stringify(body) }),
};
