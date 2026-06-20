/**
 * Cliente HTTP de Tesorería (P11, doc 06 M4): posición consolidada, cuentas bancarias,
 * transferencias internas, cierres de caja, importación de estados de cuenta, conciliación n:m y
 * revaluación mensual. Reusa `ApiError` de los maestros para preservar el cuerpo del error.
 */
import { cabecerasTenant } from './contexto-sesion';
import { ApiError } from './maestros-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...cabecerasTenant(), ...(init?.headers ?? {}) },
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

export interface SaldoCuenta {
  codigo: string;
  nombre: string;
  moneda: string | null;
  saldoVes: string;
  saldoUsd: string;
}
export interface PosicionTesoreria {
  cuentas: SaldoCuenta[];
  metodos: { codigo: string; nombre: string; cuenta: string; saldoVes: string; saldoUsd: string }[];
  bancos: { id: string; banco: string; nombre: string; moneda: string; cuenta: string; saldoVes: string; saldoUsd: string }[];
  totalVes: string;
  totalUsd: string;
}

export interface BankAccount {
  id: string;
  banco: string;
  nombre: string;
  numeroMascara: string;
  moneda: string;
  cuentaId: string;
}

export interface Transferencia {
  id: string;
  fechaFiscal: string;
  monedaOrigen: string;
  montoOrigen: string;
  monedaDestino: string;
  montoDestino: string;
  diferencialVes: string | null;
  status: string;
}

export interface PataInput {
  cuentaCodigo: string;
  moneda: string;
  monto: string;
  rateBcv?: string | null;
}
export interface TransferenciaInput {
  companyId: string;
  fecha?: string;
  descripcion?: string;
  origen: PataInput;
  destino: PataInput;
  rateUsdMgmt: string;
}

export interface Cierre {
  id: string;
  fechaFiscal: string;
  apertura: string;
  cierre: string | null;
  totalDiferenciaVes: string | null;
  status: string;
}
export interface ArqueoConteo {
  paymentMethodId: string;
  montoDeclarado: string;
}

export interface BankStatement {
  id: string;
  banco: string;
  parserVersion: string;
  archivoNombre: string;
  desde: string | null;
  hasta: string | null;
}
export interface ResultadoImportacion {
  statement: BankStatement;
  lineasInsertadas: number;
  yaImportado: boolean;
}

export type TipoMatch = 'UNO_A_UNO' | 'UNO_A_N' | 'N_A_UNO';
export interface Sugerencia {
  tipo: TipoMatch;
  score: number;
  bancoIds: string[];
  sistemaIds: string[];
}
export interface LadoBanco {
  id: string;
  fecha: string;
  descripcion: string | null;
  referencia: string | null;
  monto: string;
}
export interface LadoSistema {
  id: string;
  fecha: string;
  descripcion: string;
  monto: string;
}
export interface SugerenciasConciliacion {
  banco: LadoBanco[];
  sistema: LadoSistema[];
  sugerencias: Sugerencia[];
}
export interface GrupoConciliacion {
  tipo: TipoMatch;
  score?: string | null;
  statementLineIds: string[];
  journalLineIds: string[];
}

export interface Revaluacion {
  id: string;
  anio: number;
  mes: number;
  fechaCorte: string;
  diferencialVes: string | null;
  status: string;
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export const tesoreriaApi = {
  posicion: (companyId: string) => req<PosicionTesoreria>(`/tesoreria/posicion?companyId=${companyId}`),

  listarBancos: (companyId: string) => req<BankAccount[]>(`/tesoreria/bancos?companyId=${companyId}`),
  crearBanco: (body: Record<string, unknown>) => req<BankAccount>('/tesoreria/bancos', { method: 'POST', body: JSON.stringify(body) }),

  listarTransferencias: (companyId: string) => req<Transferencia[]>(`/tesoreria/transferencias?companyId=${companyId}`),
  crearTransferencia: (body: TransferenciaInput) => req<Transferencia>('/tesoreria/transferencias', { method: 'POST', body: JSON.stringify(body) }),

  listarCierres: (companyId: string) => req<Cierre[]>(`/tesoreria/cierres-caja?companyId=${companyId}`),
  abrirCaja: (companyId: string) => req<Cierre>('/tesoreria/cierres-caja/abrir', { method: 'POST', body: JSON.stringify({ companyId }) }),
  cerrarCaja: (body: { cierreId: string; companyId: string; rateBcv?: string | null; rateUsdMgmt: string; conteos: ArqueoConteo[] }) =>
    req<{ cierre: Cierre; arqueos: unknown[] }>('/tesoreria/cierres-caja/cerrar', { method: 'POST', body: JSON.stringify(body) }),

  importar: (body: { companyId: string; bankAccountId: string; archivoNombre: string; contenido: string; bancoEsperado?: string }) =>
    req<ResultadoImportacion>('/tesoreria/importar', { method: 'POST', body: JSON.stringify(body) }),

  sugerencias: (companyId: string, bankAccountId: string) =>
    req<SugerenciasConciliacion>(`/tesoreria/conciliacion?companyId=${companyId}&bankAccountId=${bankAccountId}`),
  conciliar: (body: { companyId: string; bankAccountId: string; grupos: GrupoConciliacion[] }) =>
    req<{ grupos: number; filas: number }>('/tesoreria/conciliacion', { method: 'POST', body: JSON.stringify(body) }),
  aceptarSugerencias: (companyId: string, bankAccountId: string) =>
    req<{ grupos: number; filas: number }>('/tesoreria/conciliacion/aceptar', { method: 'POST', body: JSON.stringify({ companyId, bankAccountId }) }),

  revaluar: (body: { companyId: string; anio: number; mes: number; rateCierre: string }) =>
    req<{ revaluacion: Revaluacion; yaEjecutada: boolean }>('/tesoreria/revaluacion', { method: 'POST', body: JSON.stringify(body) }),
  listarRevaluaciones: (companyId: string) => req<Revaluacion[]>(`/tesoreria/revaluacion?companyId=${companyId}`),
};
