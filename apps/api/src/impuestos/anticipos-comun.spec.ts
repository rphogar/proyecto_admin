import { describe, expect, it } from 'vitest';
import { ventanaFraccion } from './anticipos-comun';

describe('ventanaFraccion — ventana de fecha fiscal de la fracción de anticipo (P21)', () => {
  it('quincenal: fracción 1 = días 1–15, fracción 2 = 16–fin de mes', () => {
    expect(ventanaFraccion(2026, 6, 'QUINCENAL', 1)).toEqual({ desde: '2026-06-01', hasta: '2026-06-16' });
    expect(ventanaFraccion(2026, 6, 'QUINCENAL', 2)).toEqual({ desde: '2026-06-16', hasta: '2026-07-01' });
  });

  it('quincenal en diciembre: la segunda fracción cierra en enero del año siguiente', () => {
    expect(ventanaFraccion(2026, 12, 'QUINCENAL', 2)).toEqual({ desde: '2026-12-16', hasta: '2027-01-01' });
  });

  it('semanal: bloques de 7 días; el último corta a fin de mes', () => {
    expect(ventanaFraccion(2026, 6, 'SEMANAL', 1)).toEqual({ desde: '2026-06-01', hasta: '2026-06-08' });
    expect(ventanaFraccion(2026, 6, 'SEMANAL', 4)).toEqual({ desde: '2026-06-22', hasta: '2026-06-29' });
    // Junio tiene 30 días → la 5ª semana (día 29) corta a fin de mes (1 de julio).
    expect(ventanaFraccion(2026, 6, 'SEMANAL', 5)).toEqual({ desde: '2026-06-29', hasta: '2026-07-01' });
  });

  it('rechaza fracciones inválidas', () => {
    expect(() => ventanaFraccion(2026, 6, 'QUINCENAL', 3)).toThrow();
    expect(() => ventanaFraccion(2026, 6, 'QUINCENAL', 0)).toThrow();
    expect(() => ventanaFraccion(2026, 2, 'SEMANAL', 5)).toThrow(); // febrero no llega al día 29
  });
});
