/**
 * Política de segundo factor (docs/05 §6): el 2FA TOTP es **obligatorio** para los roles con
 * poder sobre dinero, cierres y datos sensibles (owner, admin, contador). Para el resto es
 * opcional (el usuario puede activarlo, pero no se le exige). Módulo PURO y testeable.
 *
 * El enforcement (rechazar peticiones de un rol obligado que no tiene 2FA confirmado) lo aplica
 * `DosFactoresGuard`; aquí vive solo la regla de quién está obligado.
 */
export type RolTenant = 'owner' | 'admin' | 'contador' | 'cajero' | 'vendedor' | 'auditor';

/** Roles para los que el segundo factor es obligatorio. */
export const ROLES_2FA_OBLIGATORIO: ReadonlySet<RolTenant> = new Set<RolTenant>([
  'owner',
  'admin',
  'contador',
]);

/** ¿El rol está obligado a tener 2FA activo? */
export function requiereDosFactores(rol: string): boolean {
  return ROLES_2FA_OBLIGATORIO.has(rol as RolTenant);
}

/** Estado del 2FA de un usuario (subconjunto de columnas de `users`). */
export interface EstadoDosFactores {
  totpHabilitado: boolean;
  totpConfirmadoEn: Date | null;
}

/**
 * ¿Está el usuario autorizado a operar según la política, dado su rol y el estado de su 2FA?
 * Un rol obligado debe tener TOTP habilitado y confirmado; en caso contrario debe completar la
 * activación antes de poder ejecutar acciones protegidas.
 */
export function cumplePoliticaDosFactores(rol: string, estado: EstadoDosFactores): boolean {
  if (!requiereDosFactores(rol)) {
    return true;
  }
  return estado.totpHabilitado && estado.totpConfirmadoEn !== null;
}
