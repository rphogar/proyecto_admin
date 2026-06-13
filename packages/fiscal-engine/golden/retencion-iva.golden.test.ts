import { describe, expect, it } from 'vitest';
import { calcularRetencionIva, type RetencionIvaInput } from '../src/retenciones/retencion-iva';
import golden from './retencion-iva.golden.json';

/**
 * Golden tests de la retención de IVA del agente (casos 26 y 27 del doc 07). Valores exactos en
 * retencion-iva.golden.json.
 */
describe('Retención de IVA — golden (doc 07 §C.26–27)', () => {
  it('caso 26: SPE retiene 75% del IVA (160 → 120)', () => {
    const c = golden.caso26_retencion_75;
    expect(calcularRetencionIva(c.input as RetencionIvaInput)).toEqual(c.esperado);
  });

  it('caso 27: retención 100% (datos de RIF inconsistentes)', () => {
    const c = golden.caso27_retencion_100;
    const r = calcularRetencionIva(c.input as RetencionIvaInput);
    expect(r).toEqual(c.esperado);
    // Invariante: retenido + no retenido == IVA de la factura.
    expect(Number(r.ivaRetenido) + Number(r.ivaNoRetenido)).toBeCloseTo(Number(c.input.ivaFactura), 2);
  });
});
