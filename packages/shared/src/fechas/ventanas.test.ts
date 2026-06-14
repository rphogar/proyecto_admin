import { describe, expect, it } from 'vitest';
import { ventanasVentas } from './ventanas';

describe('ventanasVentas — día/semana/mes vs período anterior (M0)', () => {
  it('día compara hoy contra ayer', () => {
    const { dia } = ventanasVentas('2026-06-14');
    expect(dia.actual).toEqual({ desde: '2026-06-14', hasta: '2026-06-14' });
    expect(dia.anterior).toEqual({ desde: '2026-06-13', hasta: '2026-06-13' });
  });

  it('semana usa 7 días terminados hoy vs los 7 anteriores (sin solaparse)', () => {
    const { semana } = ventanasVentas('2026-06-14');
    expect(semana.actual).toEqual({ desde: '2026-06-08', hasta: '2026-06-14' });
    expect(semana.anterior).toEqual({ desde: '2026-06-01', hasta: '2026-06-07' });
  });

  it('mes es del 1.° a hoy vs el mismo número de días del mes anterior', () => {
    const { mes } = ventanasVentas('2026-06-14');
    expect(mes.actual).toEqual({ desde: '2026-06-01', hasta: '2026-06-14' });
    // 13 días transcurridos (día 14) → mayo 1 a mayo 14.
    expect(mes.anterior).toEqual({ desde: '2026-05-01', hasta: '2026-05-14' });
  });

  it('el mes anterior se acota a su último día (31-mar vs 28-feb, no 31-feb)', () => {
    const { mes } = ventanasVentas('2026-03-31');
    expect(mes.actual).toEqual({ desde: '2026-03-01', hasta: '2026-03-31' });
    expect(mes.anterior).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('el día 1.° del mes da una ventana mensual de un solo día', () => {
    const { mes } = ventanasVentas('2026-06-01');
    expect(mes.actual).toEqual({ desde: '2026-06-01', hasta: '2026-06-01' });
    expect(mes.anterior).toEqual({ desde: '2026-05-01', hasta: '2026-05-01' });
  });

  it('cruza el fin de año en la comparación semanal', () => {
    const { semana } = ventanasVentas('2026-01-03');
    expect(semana.actual).toEqual({ desde: '2025-12-28', hasta: '2026-01-03' });
    expect(semana.anterior).toEqual({ desde: '2025-12-21', hasta: '2025-12-27' });
  });

  it('rechaza una fecha inválida', () => {
    expect(() => ventanasVentas('no-es-fecha')).toThrow(/inválida/);
  });
});
