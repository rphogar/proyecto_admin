import { describe, expect, it } from 'vitest';
import { StubRemisionAdapter } from './remision-adapter';

/**
 * Adapter de remisión por defecto (P17, Providencia 121 §6.3 req. 2). Mientras el SENIAT no publique
 * el canal técnico, el stub reporta el canal como no disponible (REINTENTABLE) → los ítems quedan en
 * cola reintentándose, sin marcarse como error permanente. La lógica de estados/backoff de la cola se
 * prueba contra Postgres en cumplimiento.int.spec.ts.
 */
describe('StubRemisionAdapter', () => {
  it('reporta el canal como no disponible y reintentable', async () => {
    const resultado = await new StubRemisionAdapter().transmitir({ documentId: 'd1' });
    expect(resultado.tipo).toBe('REINTENTABLE');
    if (resultado.tipo === 'REINTENTABLE') {
      expect(resultado.motivo).toMatch(/no disponible/i);
    }
  });
});
