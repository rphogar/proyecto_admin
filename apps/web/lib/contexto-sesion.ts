/**
 * Capa de persistencia de la "sesión activa" en el navegador (localStorage). Provisional hasta la
 * auth real: hoy la sesión se obtiene del login demo (`/dev/sesion`) y guarda el tenant/empresa/
 * usuario elegidos. La API exige `x-tenant-id` en todas las rutas (middleware de tenant), así que
 * `cabecerasTenant()` es lo que hace que CUALQUIER llamada al backend funcione.
 *
 * TODO(auth): cuando exista login/JWT, estas cabeceras se reemplazan por el token y la sesión deja
 * de vivir en localStorage.
 */

export const CLAVES = {
  tenantId: 'contave.tenantId',
  companyId: 'contave.companyId',
  userId: 'contave.userId',
  empresaNombre: 'contave.empresaNombre',
} as const;

export interface SesionActiva {
  tenantId: string;
  companyId: string;
  userId: string;
  empresaNombre: string;
}

/** Lee la sesión de localStorage; `null` si falta cualquier pieza obligatoria o no hay `window`. */
export function leerSesion(): SesionActiva | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const tenantId = window.localStorage.getItem(CLAVES.tenantId);
  const companyId = window.localStorage.getItem(CLAVES.companyId);
  const userId = window.localStorage.getItem(CLAVES.userId);
  if (!tenantId || !companyId || !userId) {
    return null;
  }
  return {
    tenantId,
    companyId,
    userId,
    empresaNombre: window.localStorage.getItem(CLAVES.empresaNombre) ?? companyId,
  };
}

/** Persiste la sesión activa. */
export function guardarSesion(s: SesionActiva): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(CLAVES.tenantId, s.tenantId);
  window.localStorage.setItem(CLAVES.companyId, s.companyId);
  window.localStorage.setItem(CLAVES.userId, s.userId);
  window.localStorage.setItem(CLAVES.empresaNombre, s.empresaNombre);
}

/** Cierra la sesión (logout demo). */
export function limpiarSesion(): void {
  if (typeof window === 'undefined') {
    return;
  }
  for (const clave of Object.values(CLAVES)) {
    window.localStorage.removeItem(clave);
  }
}

/**
 * Cabeceras de contexto que TODO cliente HTTP debe enviar. Sin `x-tenant-id` la API responde 400.
 * Si aún no hay sesión, devuelve `{}` (la llamada fallará con 400, que es el comportamiento correcto
 * mientras no se haya entrado a una empresa).
 */
export function cabecerasTenant(): Record<string, string> {
  const s = leerSesion();
  if (s === null) {
    return {};
  }
  return { 'x-tenant-id': s.tenantId, 'x-user-id': s.userId };
}
