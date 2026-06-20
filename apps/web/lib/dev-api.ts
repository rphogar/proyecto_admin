import type { SesionActiva } from './contexto-sesion';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Respuesta de `GET /dev/sesion` (login demo de desarrollo). */
interface SesionDemoDto {
  tenantId: string;
  companyId: string;
  userId: string;
  tenantNombre: string;
  empresaNombre: string;
  usuarioEmail: string;
}

/**
 * Obtiene la sesión de la empresa DEMO del backend (solo desarrollo). Mientras no exista la auth
 * real, esto reemplaza al "pegar UUID a mano": un clic entra a la empresa sembrada por `db:seed-demo`.
 */
export async function fetchSesionDemo(): Promise<SesionActiva> {
  const resp = await fetch(`${API_BASE}/dev/sesion`);
  if (!resp.ok) {
    let detalle = `Error ${resp.status}`;
    try {
      const body = (await resp.json()) as { message?: unknown };
      if (body && typeof body.message === 'string') {
        detalle = body.message;
      }
    } catch {
      // sin cuerpo
    }
    throw new Error(detalle);
  }
  const dto = (await resp.json()) as SesionDemoDto;
  return {
    tenantId: dto.tenantId,
    companyId: dto.companyId,
    userId: dto.userId,
    empresaNombre: dto.empresaNombre,
  };
}
