import type { EstadoFrescura } from '@contave/shared';

/** Respuesta de `GET /tasas/dia` (espejo de `TasaDelDiaDto` de la API). */
export interface TasaDelDiaDto {
  moneda: string;
  fecha: string;
  rate: string | null;
  rateDate: string | null;
  source: string | null;
  frescura: EstadoFrescura;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Tasa del día para `moneda` (default USD), con estado de frescura para el banner (caso 57). */
export async function fetchTasaDelDia(moneda = 'USD'): Promise<TasaDelDiaDto> {
  const resp = await fetch(`${API_BASE}/tasas/dia?moneda=${encodeURIComponent(moneda)}`);
  if (!resp.ok) {
    throw new Error(`Error ${resp.status} al obtener la tasa del día`);
  }
  return resp.json() as Promise<TasaDelDiaDto>;
}
