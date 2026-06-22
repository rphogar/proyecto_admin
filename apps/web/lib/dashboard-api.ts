/**
 * Cliente HTTP del Dashboard del dueño (P14, docs/06 M0). Una sola lectura (`GET /dashboard`) trae
 * todos los widgets de la vista móvil-primero, derivados en vivo del ledger (regla 8). Reusa
 * `ApiError` de los maestros para preservar el cuerpo del error.
 */
import { cabecerasTenant } from './contexto-sesion';
import { ApiError } from './maestros-api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { headers: cabecerasTenant() });
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
  return resp.json() as Promise<T>;
}

// ── Tipos (espejo de DashboardDto de la API) ────────────────────────────────────

export interface MontoDoble {
  ves: string;
  usd: string;
}

export interface VentasComparativo {
  actual: MontoDoble;
  anterior: MontoDoble;
  variacionPct: string | null;
}

export interface DeudorDashboard {
  partyId: string;
  nombre: string;
  rif: string;
  telefono: string | null;
  saldoVes: string;
  saldoUsd: string;
  diasVencido: number;
}

export interface ProveedorPorPagar {
  partyId: string;
  nombre: string;
  rif: string;
  saldoVes: string;
  saldoUsd: string;
  fechaVence: string | null;
  diasRestantes: number | null;
}

export interface ObligacionFiscal {
  tipo: string;
  periodo: string;
  fechaLimite: string;
  diasRestantes: number;
  estado: 'PRESENTADA' | 'PENDIENTE';
}

export interface ProductoTop {
  sku: string;
  descripcion: string;
  cantidad: string;
  ventasVes: string;
  ventasUsd: string;
}

export interface AlertaDashboard {
  tipo: 'CXC_VENCIDA' | 'DECLARACION';
  severidad: 'alta' | 'media';
  mensaje: string;
}

export interface DashboardDto {
  fecha: string;
  caja: { totalVes: string; totalUsd: string; metodos: { codigo: string; nombre: string; saldoVes: string; saldoUsd: string }[] };
  ventas: { dia: VentasComparativo; semana: VentasComparativo; mes: VentasComparativo };
  utilidadMes: MontoDoble;
  cxc: { totalPorCobrar: MontoDoble; totalVencido: MontoDoble; topDeudores: DeudorDashboard[] };
  cxp: { totalPorPagar: MontoDoble; proximas: ProveedorPorPagar[] };
  tasaBcv: { moneda: string; rate: string | null; rateDate: string | null; variacionPct: string | null; frescura: string } | null;
  tasaBcvEur: { moneda: string; rate: string | null; rateDate: string | null; variacionPct: string | null; frescura: string } | null;
  semaforoFiscal: { obligaciones: ObligacionFiscal[] };
  topProductos: ProductoTop[];
  alertas: AlertaDashboard[];
}

export const dashboardApi = {
  resumen: (companyId: string) => req<DashboardDto>(`/dashboard?companyId=${encodeURIComponent(companyId)}`),
};
