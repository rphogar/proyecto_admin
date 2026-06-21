import { describe, expect, it } from 'vitest';
import { type ConteosCola, evaluarAlertas, tasaError, UMBRALES_REMISION } from './observabilidad';

/**
 * Observabilidad de la cola de remisión (P25): funciones puras de agregación de alertas. Determinismo
 * (golden-style): mismas entradas → mismas alertas. Los umbrales son SLOs operativos, no normativos.
 */
function conteos(p: Partial<ConteosCola>): ConteosCola {
  const c = { pendiente: 0, enviado: 0, acusado: 0, error: 0, total: 0, ...p };
  c.total = c.pendiente + c.enviado + c.acusado + c.error;
  return c;
}

describe('tasaError', () => {
  it('es 0 cuando no hay desenlaces terminales', () => {
    expect(tasaError(0, 0)).toBe(0);
  });
  it('es errores / (acusados + errores)', () => {
    expect(tasaError(3, 1)).toBeCloseTo(0.25);
  });
});

describe('evaluarAlertas', () => {
  it('no alerta cuando la cola está sana', () => {
    const alertas = evaluarAlertas({
      conteos: conteos({ acusado: 50 }),
      pendientesElegibles: 3,
      antiguedadPendienteSegundos: 120,
      tasaError: 0,
    });
    expect(alertas).toHaveLength(0);
  });

  it('alerta media por antigüedad sobre 1 h y alta sobre 6 h', () => {
    const media = evaluarAlertas({ conteos: conteos({ pendiente: 1 }), pendientesElegibles: 1, antiguedadPendienteSegundos: 2 * 3600, tasaError: 0 });
    expect(media.find((a) => a.codigo === 'PENDIENTE_ANTIGUO')?.severidad).toBe('media');

    const alta = evaluarAlertas({ conteos: conteos({ pendiente: 1 }), pendientesElegibles: 1, antiguedadPendienteSegundos: 7 * 3600, tasaError: 0 });
    expect(alta.find((a) => a.codigo === 'PENDIENTE_ANTIGUO')?.severidad).toBe('alta');
  });

  it('alerta por backlog elegible alto', () => {
    const alertas = evaluarAlertas({
      conteos: conteos({ pendiente: UMBRALES_REMISION.backlogElegible }),
      pendientesElegibles: UMBRALES_REMISION.backlogElegible,
      antiguedadPendienteSegundos: 10,
      tasaError: 0,
    });
    expect(alertas.some((a) => a.codigo === 'BACKLOG_ELEGIBLE')).toBe(true);
  });

  it('alerta por tasa de error alta solo con muestra significativa', () => {
    // Muestra pequeña: no alerta aunque la tasa sea 100%.
    const pequena = evaluarAlertas({ conteos: conteos({ acusado: 1, error: 2 }), pendientesElegibles: 0, antiguedadPendienteSegundos: null, tasaError: tasaError(1, 2) });
    expect(pequena.some((a) => a.codigo === 'TASA_ERROR_ALTA')).toBe(false);

    // Muestra significativa con >50% de error → severidad alta.
    const grande = evaluarAlertas({ conteos: conteos({ acusado: 4, error: 8 }), pendientesElegibles: 0, antiguedadPendienteSegundos: null, tasaError: tasaError(4, 8) });
    const alerta = grande.find((a) => a.codigo === 'TASA_ERROR_ALTA');
    expect(alerta?.severidad).toBe('alta');
  });
});
