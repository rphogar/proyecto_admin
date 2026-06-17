import { describe, expect, it } from 'vitest';
import { calcularEventHash, type EslabonCadena, type InsumoEventoHash, verificarCadena } from './cadena-hash';

/**
 * Encadenamiento criptográfico de la bitácora fiscal (P17, Providencia 121 §6.3 req. 1). Pruebas
 * puras: determinismo, sensibilidad al contenido, independencia del orden de claves del payload
 * (jsonb) y detección de manipulación al reverificar la cadena.
 */
describe('cadena-hash (bitácora fiscal encadenada)', () => {
  const base: InsumoEventoHash = {
    prevHash: null,
    tenantId: 't1',
    companyId: 'c1',
    documentId: 'd1',
    eventType: 'EMISION',
    documentNumber: 'A1',
    controlNumber: '00-001',
    hashDocumento: 'abc',
    tsUtc: '2026-06-16T12:00:00.000Z',
    payload: { numero: 1, totalVes: '116.00' },
  };

  it('es determinista: mismo insumo → mismo hash', () => {
    expect(calcularEventHash(base)).toBe(calcularEventHash(base));
  });

  it('cambia si cambia cualquier campo del evento', () => {
    const h = calcularEventHash(base);
    expect(calcularEventHash({ ...base, eventType: 'ANULACION' })).not.toBe(h);
    expect(calcularEventHash({ ...base, documentNumber: 'A2' })).not.toBe(h);
    expect(calcularEventHash({ ...base, payload: { numero: 2, totalVes: '116.00' } })).not.toBe(h);
  });

  it('encadena: el prevHash distinto cambia el hash (no se puede reordenar la cadena)', () => {
    expect(calcularEventHash({ ...base, prevHash: 'otro' })).not.toBe(calcularEventHash(base));
  });

  it('es estable ante el reordenamiento de claves del payload (jsonb no preserva orden)', () => {
    const a = calcularEventHash({ ...base, payload: { numero: 1, totalVes: '116.00' } });
    const b = calcularEventHash({ ...base, payload: { totalVes: '116.00', numero: 1 } });
    expect(a).toBe(b);
  });

  it('verificarCadena: una cadena bien encadenada es íntegra', () => {
    const e1 = construir({ ...base, prevHash: null });
    const e2 = construir({ ...base, prevHash: e1.eventHash, documentId: 'd2', documentNumber: 'A2' });
    const e3 = construir({ ...base, prevHash: e2.eventHash, documentId: 'd3', documentNumber: 'A3' });
    expect(verificarCadena([e1, e2, e3])).toEqual({ ok: true, total: 3, rotoEn: null, motivo: null });
  });

  it('verificarCadena: detecta contenido alterado (event_hash no recomputa)', () => {
    const e1 = construir({ ...base, prevHash: null });
    const e2 = construir({ ...base, prevHash: e1.eventHash, documentId: 'd2' });
    const manipulado: EslabonCadena = { ...e2, documentNumber: 'FALSIFICADO' }; // hash no recomputa
    const r = verificarCadena([e1, manipulado]);
    expect(r.ok).toBe(false);
    expect(r.rotoEn).toBe(1);
  });

  it('verificarCadena: detecta un eslabón eliminado (prev_hash no enlaza)', () => {
    const e1 = construir({ ...base, prevHash: null });
    const e2 = construir({ ...base, prevHash: e1.eventHash, documentId: 'd2' });
    const e3 = construir({ ...base, prevHash: e2.eventHash, documentId: 'd3' });
    // Falta e2: e3.prevHash apunta a e2, no a e1.
    const r = verificarCadena([e1, e3]);
    expect(r.ok).toBe(false);
    expect(r.rotoEn).toBe(1);
  });
});

function construir(insumo: InsumoEventoHash): EslabonCadena {
  return { ...insumo, eventHash: calcularEventHash(insumo) };
}
