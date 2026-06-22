import { describe, expect, it } from 'vitest';
import { ControlBloqueoLogin } from './control-bloqueo-login';

/**
 * Pruebas del lockout de login (P27). Instante inyectado → deterministas. Opciones pequeñas para
 * legibilidad: 3 fallos en 10 s bloquean 60 s.
 */
const OPTS = { maxIntentos: 3, ventanaMs: 10_000, bloqueoMs: 60_000 };

describe('ControlBloqueoLogin', () => {
  it('bloquea al alcanzar el máximo de fallos dentro de la ventana', () => {
    const c = new ControlBloqueoLogin(OPTS);
    expect(c.registrarFallo('ana@x.com', 0).bloqueado).toBe(false);
    expect(c.registrarFallo('ana@x.com', 1_000).bloqueado).toBe(false);
    const r = c.registrarFallo('ana@x.com', 2_000);
    expect(r.bloqueado).toBe(true);
    expect(r.restanteMs).toBe(60_000);
    // Y sigue bloqueado en consultas posteriores dentro del plazo.
    expect(c.estado('ana@x.com', 30_000).bloqueado).toBe(true);
  });

  it('libera el bloqueo al expirar', () => {
    const c = new ControlBloqueoLogin(OPTS);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 0);
    expect(c.estado('ana@x.com', 59_000).bloqueado).toBe(true);
    expect(c.estado('ana@x.com', 60_000).bloqueado).toBe(false);
  });

  it('no acumula fallos viejos fuera de la ventana', () => {
    const c = new ControlBloqueoLogin(OPTS);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 1_000);
    // El tercer fallo llega cuando los dos primeros ya salieron de la ventana de 10 s.
    expect(c.registrarFallo('ana@x.com', 12_000).bloqueado).toBe(false);
  });

  it('reiniciar olvida los fallos (login exitoso)', () => {
    const c = new ControlBloqueoLogin(OPTS);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 1_000);
    c.reiniciar('ana@x.com');
    expect(c.registrarFallo('ana@x.com', 2_000).bloqueado).toBe(false);
  });

  it('aísla claves distintas (otro email/origen no se ve afectado)', () => {
    const c = new ControlBloqueoLogin(OPTS);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 0);
    c.registrarFallo('ana@x.com', 0);
    expect(c.estado('ana@x.com', 0).bloqueado).toBe(true);
    expect(c.estado('beto@x.com', 0).bloqueado).toBe(false);
  });
});
