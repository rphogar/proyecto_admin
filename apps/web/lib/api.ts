import type { EstadoFrescura } from '@contave/shared';
import { cabecerasTenant } from './contexto-sesion';

/** Respuesta de `GET /tasas/dia` (espejo de `TasaDelDiaDto` de la API). */
export interface TasaDelDiaDto {
  moneda: string;
  fecha: string;
  rate: string | null;
  rateDate: string | null;
  source: string | null;
  frescura: EstadoFrescura;
}

/** Cuerpo de una entrada manual de tasa (`POST /tasas/manual`). */
export interface CrearTasaManualInput {
  moneda: string;
  rate: string;
  rateDate: string;
  motivo: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Tasa del día para `moneda` (default USD), con estado de frescura para el banner (caso 57). */
export async function fetchTasaDelDia(moneda = 'USD'): Promise<TasaDelDiaDto> {
  const resp = await fetch(`${API_BASE}/tasas/dia?moneda=${encodeURIComponent(moneda)}`, {
    headers: cabecerasTenant(),
  });
  if (!resp.ok) {
    throw new Error(`Error ${resp.status} al obtener la tasa del día`);
  }
  return resp.json() as Promise<TasaDelDiaDto>;
}

/**
 * Carga MANUAL de tasa (fallback del caso 57: el BCV no publicó o el job no corrió). Queda auditada
 * y append-only en el backend (`POST /tasas/manual`). Requiere sesión activa (cabecera de tenant).
 */
export async function crearTasaManual(input: CrearTasaManualInput): Promise<void> {
  const resp = await fetch(`${API_BASE}/tasas/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecerasTenant() },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    let detalle = `Error ${resp.status}`;
    try {
      const body = (await resp.json()) as { message?: unknown };
      if (body && typeof body.message === 'string') {
        detalle = body.message;
      }
    } catch {
      // sin cuerpo JSON
    }
    throw new Error(detalle);
  }
}
