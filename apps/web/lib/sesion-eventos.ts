/**
 * Bus mínimo de eventos de sesión (P32). Cuando una llamada de negocio recibe **401** (token vencido
 * o revocado), el cliente HTTP no puede arreglarlo solo: hay que cerrar la sesión local y mandar al
 * usuario a re-autenticarse. En vez de acoplar cada `fetch` al router de Next, se emite un evento de
 * ventana que un único guardia (`GuardiaSesion`, montado en el provider) atiende: cierra sesión y
 * redirige a `/login?expirada=1`, donde el login muestra un aviso claro.
 *
 * Se usa `window` como bus para no introducir otra dependencia y para que funcione desde cualquier
 * cliente HTTP (TanStack Query o `fetch` directo). En SSR no hay `window`: las funciones son no-op.
 */

/** Nombre del evento de ventana que señala "tu sesión expiró, hay que volver a entrar". */
export const EVENTO_SESION_EXPIRADA = 'contave:sesion-expirada';

/** Query param que el login lee para mostrar el aviso de sesión expirada. */
export const PARAM_SESION_EXPIRADA = 'expirada';

/** Emite el evento de sesión expirada. Idempotente y seguro en SSR. */
export function notificarSesionExpirada(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENTO_SESION_EXPIRADA));
}

/** Suscribe `handler` al evento; devuelve la función para desuscribir. No-op en SSR. */
export function alExpirarSesion(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  window.addEventListener(EVENTO_SESION_EXPIRADA, handler);
  return () => window.removeEventListener(EVENTO_SESION_EXPIRADA, handler);
}
