import { describe, expect, it } from 'vitest';
import { baseIslrDeLineas } from './base-islr-lineas';

describe('baseIslrDeLineas — base de ISLR en pagos mixtos (caso 32)', () => {
  it('retiene solo sobre la porción de servicio cuando las líneas vienen discriminadas', () => {
    const r = baseIslrDeLineas([
      { base: '3000.00', sujetoIslr: true }, // mano de obra / servicio
      { base: '7000.00', sujetoIslr: false }, // materiales
    ]);
    expect(r.base).toBe('3000.00');
    expect(r.huboDiscriminacion).toBe(true);
    expect(r.usoTotalPorFaltaDeDiscriminacion).toBe(false);
  });

  it('retiene sobre el total si ninguna línea viene marcada (criterio conservador)', () => {
    const r = baseIslrDeLineas([{ base: '3000.00' }, { base: '7000.00' }]);
    expect(r.base).toBe('10000.00');
    expect(r.huboDiscriminacion).toBe(false);
    expect(r.usoTotalPorFaltaDeDiscriminacion).toBe(true);
  });

  it('suma varias líneas de servicio discriminadas', () => {
    const r = baseIslrDeLineas([
      { base: '1500.50', sujetoIslr: true },
      { base: '2499.50', sujetoIslr: true },
      { base: '500.00', sujetoIslr: false },
    ]);
    expect(r.base).toBe('4000.00');
  });
});
