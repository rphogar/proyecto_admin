/**
 * Persistencia de la sesión real en el navegador (P28). Tras el login, la API entrega un access JWT
 * (acotado a un tenant), un refresh rotativo y la lista de empresas del usuario. Todo eso vive aquí
 * en `localStorage`; `cabecerasAuth()` adjunta el `Authorization: Bearer` que TODA llamada de
 * negocio necesita (el middleware de tenant deriva el tenant/actor del token, no de cabeceras del
 * cliente). El refresh rotativo y el cambio de empresa actualizan este blob.
 */

const CLAVE = 'contave.sesion';

/** Una empresa (tenant) del usuario, con su rol — sale de `GET /auth/empresas`. */
export interface EmpresaMembresia {
  tenantId: string;
  nombre: string;
  rol: string;
}

/** Una empresa (RIF) dentro del tenant activo — sale de `GET /maestros/companias`. */
export interface Compania {
  id: string;
  rif: string;
  razonSocial: string;
}

/** Sesión activa completa que se persiste. */
export interface SesionActiva {
  accessToken: string;
  refreshToken: string;
  /** Tenant al que está acotado el access actual (`tid`). */
  tenantActivo: string;
  /** Instante (epoch ms) en que expira el access; dispara el refresh proactivo. */
  expiraEn: number;
  /** Empresas (tenants) del usuario para el selector. */
  empresas: EmpresaMembresia[];
  /** Empresas (RIF) del tenant activo. */
  companias: Compania[];
  /** Empresa (RIF) activa dentro del tenant — la consumen ~20 pantallas. */
  companyId: string;
  /** Nombre para mostrar en la barra (razón social de la empresa activa). */
  empresaNombre: string;
}

/** Lee la sesión de localStorage; `null` si falta o el JSON es inválido o no hay `window`. */
export function leerSesion(): SesionActiva | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(CLAVE);
  if (!raw) {
    return null;
  }
  try {
    const s = JSON.parse(raw) as SesionActiva;
    if (!s.accessToken || !s.refreshToken || !s.tenantActivo) {
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

/** Persiste la sesión activa. */
export function guardarSesion(s: SesionActiva): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CLAVE, JSON.stringify(s));
}

/** Cierra la sesión local (no llama a la API). */
export function limpiarSesion(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(CLAVE);
}

/**
 * Cabeceras de autenticación que TODO cliente HTTP de negocio debe enviar. Sin un `Authorization`
 * válido la API responde 401. Si aún no hay sesión, devuelve `{}` (la llamada fallará con 401, que
 * es el comportamiento correcto mientras no se haya entrado).
 */
export function cabecerasAuth(): Record<string, string> {
  const s = leerSesion();
  if (s === null) {
    return {};
  }
  return { Authorization: `Bearer ${s.accessToken}` };
}
