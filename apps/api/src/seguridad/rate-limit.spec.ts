import { describe, expect, it } from 'vitest';
import { LimitadorVentanaDeslizante } from './rate-limit';

describe('LimitadorVentanaDeslizante', () => {
  it('admite hasta el límite y bloquea el siguiente', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 3, ventanaMs: 1000 });
    expect(lim.consumir('ip', 0).permitido).toBe(true);
    expect(lim.consumir('ip', 100).permitido).toBe(true);
    const tercero = lim.consumir('ip', 200);
    expect(tercero.permitido).toBe(true);
    expect(tercero.restante).toBe(0);

    const bloqueado = lim.consumir('ip', 300);
    expect(bloqueado.permitido).toBe(false);
    expect(bloqueado.restante).toBe(0);
  });

  it('libera cupo cuando la marca más antigua sale de la ventana', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 2, ventanaMs: 1000 });
    lim.consumir('ip', 0);
    lim.consumir('ip', 500);
    expect(lim.consumir('ip', 900).permitido).toBe(false);

    // En t=1001 la marca de t=0 ya salió de la ventana (1000 ms) → 1 cupo libre.
    const liberado = lim.consumir('ip', 1001);
    expect(liberado.permitido).toBe(true);
  });

  it('calcula reintentarEnMs como el tiempo hasta liberar un cupo', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 1, ventanaMs: 1000 });
    lim.consumir('ip', 200);
    const bloqueado = lim.consumir('ip', 700);
    expect(bloqueado.permitido).toBe(false);
    // La marca de t=200 sale en t=1200 → faltan 500 ms.
    expect(bloqueado.reintentarEnMs).toBe(500);
  });

  it('aísla el conteo por clave', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 1, ventanaMs: 1000 });
    expect(lim.consumir('a', 0).permitido).toBe(true);
    expect(lim.consumir('a', 1).permitido).toBe(false);
    expect(lim.consumir('b', 1).permitido).toBe(true);
  });

  it('reiniciar olvida el estado de una clave', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 1, ventanaMs: 1000 });
    lim.consumir('login:ana', 0);
    expect(lim.consumir('login:ana', 1).permitido).toBe(false);
    lim.reiniciar('login:ana');
    expect(lim.consumir('login:ana', 2).permitido).toBe(true);
  });

  it('podar elimina claves sin eventos vigentes', () => {
    const lim = new LimitadorVentanaDeslizante({ limite: 5, ventanaMs: 1000 });
    lim.consumir('vieja', 0);
    lim.consumir('nueva', 1500);
    lim.podar(2000);
    // 'vieja' fue podada → vuelve a tener todo el cupo desde cero.
    expect(lim.consumir('vieja', 2000).restante).toBe(4);
  });

  it('rechaza configuración no positiva', () => {
    expect(() => new LimitadorVentanaDeslizante({ limite: 0, ventanaMs: 1000 })).toThrow();
    expect(() => new LimitadorVentanaDeslizante({ limite: 5, ventanaMs: 0 })).toThrow();
  });
});
