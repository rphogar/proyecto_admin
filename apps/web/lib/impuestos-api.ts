/**
 * Cliente HTTP del módulo de Impuestos (P10/P21, doc 06 M7): planilla borrador de IVA (forma 99030),
 * declaración de IGTF percibido, anticipos quincenales/semanales de SPE, calendario SPE y presentación
 * de declaraciones (snapshot inmutable). Reusa `ApiError` de los maestros para preservar el error.
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
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export type TipoAnticipo = 'ANTICIPO_IVA' | 'ANTICIPO_ISLR';

export interface ResumenLibroGrupo {
  alicuotaCodigo: string;
  alicuotaTasa: string;
  base: string;
  monto: string;
}

export interface ResumenLibro {
  grupos: ResumenLibroGrupo[];
  baseGravada: string;
  ivaTotal: string;
  baseExenta: string;
  baseExonerada: string;
  baseExportacion: string;
  baseTotal: string;
  totalConIva: string;
}

export interface PlanillaIva {
  debitoFiscal: string;
  creditoFiscalDelPeriodo: string;
  porcentajeProrrata: string;
  creditoFiscalDeducible: string;
  creditoFiscalAlCosto: string;
  excedenteCreditoAnterior: string;
  cuotaTributaria: string;
  retencionesDelPeriodo: string;
  excedenteRetencionesAnterior: string;
  retencionesAcumuladas: string;
  cuotaAPagar: string;
  excedenteCreditoSiguiente: string;
  excedenteRetencionesSiguiente: string;
}

export interface PlanillaIvaBorrador {
  tipo: 'IVA';
  periodo: { anio: number; mes: number };
  empresa: { rif: string; razonSocial: string };
  libroVentas: ResumenLibro;
  libroCompras: ResumenLibro;
  retencionesSoportadas: string;
  planilla: PlanillaIva;
  cuadre: { debitoCuadra: boolean; creditoCuadra: boolean };
}

export interface DeclaracionIgtfGrupo {
  alicuota: string;
  baseVes: string;
  igtfVes: string;
  operaciones: number;
}

export interface DeclaracionIgtfBorrador {
  tipo: 'IGTF';
  periodo: { anio: number; mes: number };
  empresa: { rif: string; razonSocial: string };
  declaracion: {
    grupos: DeclaracionIgtfGrupo[];
    baseTotalVes: string;
    igtfTotalVes: string;
    operaciones: number;
  };
}

export interface AnticipoBorrador {
  tipo: TipoAnticipo;
  periodo: { anio: number; mes: number; subperiodo: number };
  empresa: { rif: string; razonSocial: string };
  cadencia: 'QUINCENAL' | 'SEMANAL';
  ventana: { desde: string; hasta: string };
  ingresosBrutos: string;
  operaciones: number;
  parametroPorDefecto: boolean;
  anticipo: {
    baseImponible: string;
    porcentaje: string;
    anticipoCalculado: string;
    creditosAplicados: string;
    anticipoAPagar: string;
    excedenteCreditosSiguiente: string;
  };
}

export interface Declaracion {
  id: string;
  tipo: string;
  periodoAnio: number;
  periodoMes: number;
  subperiodo: number;
  status: string;
  numeroDeclaracion: string | null;
  presentadoAt: string | null;
}

export interface EntradaCalendarioSpe {
  terminalRif: string;
  tipo: string;
  periodoAnio: number;
  periodoMes: number;
  subperiodo?: number;
  fechaLimite: string;
}

export interface PresentarInput {
  companyId: string;
  tipo: 'IVA' | 'IGTF' | TipoAnticipo;
  anio: number;
  mes: number;
  subperiodo?: number;
  numeroDeclaracion?: string | null;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  return sp.toString();
}

export const impuestosApi = {
  planillaIva: (companyId: string, anio: number, mes: number): Promise<PlanillaIvaBorrador> =>
    req(`/impuestos/iva?${qs({ companyId, anio, mes })}`),
  declaracionIgtf: (companyId: string, anio: number, mes: number): Promise<DeclaracionIgtfBorrador> =>
    req(`/impuestos/igtf?${qs({ companyId, anio, mes })}`),
  anticipo: (companyId: string, tipo: TipoAnticipo, anio: number, mes: number, subperiodo: number): Promise<AnticipoBorrador> =>
    req(`/impuestos/anticipo?${qs({ companyId, tipo, anio, mes, subperiodo })}`),
  listar: (companyId: string): Promise<Declaracion[]> => req(`/impuestos/declaraciones?${qs({ companyId })}`),
  presentar: (body: PresentarInput): Promise<Declaracion> => req('/impuestos/declaraciones/presentar', { method: 'POST', body: JSON.stringify(body) }),
  calendarioSpe: (anio: number): Promise<{ anio: number; entradas: EntradaCalendarioSpe[] }> =>
    req(`/impuestos/calendario-spe?${qs({ anio })}`),
  importarCalendarioSpe: (anio: number, entradas: EntradaCalendarioSpe[]): Promise<{ anio: number; entradas: number }> =>
    req('/impuestos/calendario-spe/importar', { method: 'POST', body: JSON.stringify({ anio, entradas }) }),
};
