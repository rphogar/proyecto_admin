import { describe, expect, it } from 'vitest';
import { backoffSegundos, proximoIntento } from './backoff';

/**
 * Backoff exponencial de la cola de remisión (P17, Providencia 121 §6.3 req. 2): reintentar de forma
 * continua sin martillar el canal del SENIAT. Pruebas puras.
 */
describe('backoff de remisión', () => {
  it('crece exponencialmente desde la base', () => {
    expect(backoffSegundos(0)).toBe(30);
    expect(backoffSegundos(1)).toBe(60);
    expect(backoffSegundos(2)).toBe(120);
    expect(backoffSegundos(3)).toBe(240);
  });

  it('respeta el tope de 1 hora', () => {
    expect(backoffSegundos(20)).toBe(3600);
    expect(backoffSegundos(100)).toBe(3600);
  });

  it('proximoIntento suma el backoff al instante dado', () => {
    const desde = new Date('2026-06-16T12:00:00.000Z');
    expect(proximoIntento(1, desde).toISOString()).toBe('2026-06-16T12:01:00.000Z');
  });
});
