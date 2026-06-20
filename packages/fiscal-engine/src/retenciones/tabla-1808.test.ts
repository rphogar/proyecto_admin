import { describe, expect, it } from 'vitest';
import {
  calcularRetencion1808,
  resolverConcepto1808,
  TABLA_1808_DEFECTO,
  type ConceptoIslr1808,
} from './tabla-1808';

const honorarios = resolverConcepto1808(TABLA_1808_DEFECTO, '001') as ConceptoIslr1808;
const servicios = resolverConcepto1808(TABLA_1808_DEFECTO, '002') as ConceptoIslr1808;

describe('Tabla 1.808 — catálogo de conceptos (Decreto 1.808, docs/02 §4)', () => {
  it('resuelve un concepto existente y devuelve null para uno inexistente', () => {
    expect(honorarios.descripcion).toBe('Honorarios profesionales');
    expect(resolverConcepto1808(TABLA_1808_DEFECTO, '999')).toBeNull();
  });

  it('la tabla por defecto trae las tarifas PN/PJ de docs/02 §4', () => {
    expect(honorarios.tarifaPnResidente).toBe('3');
    expect(honorarios.tarifaPjDomiciliada).toBe('5');
    expect(servicios.tarifaPnResidente).toBe('1');
    expect(servicios.tarifaPjDomiciliada).toBe('2');
  });
});

describe('calcularRetencion1808 — resolución por concepto y tipo de persona', () => {
  it('caso 31: honorarios PN residente 3% con sustraendo derivado de la UT', () => {
    // UT 9 → sustraendo = 9 × 83,3334 × 3% = 22,50; base 10.000 → 300 − 22,50 = 277,50.
    const r = calcularRetencion1808({ concepto: honorarios, tipoPersona: 'PN_RESIDENTE', base: '10000.00', valorUt: '9' });
    expect(r.sustraendo).toBe('22.50');
    expect(r.retencion).toBe('277.50');
    expect(r.bajoUmbral).toBe(false);
    expect(r.concepto).toBe('001');
  });

  it('caso 31: base bajo el umbral → retención 0 (el sustraendo absorbe la retención)', () => {
    const r = calcularRetencion1808({ concepto: honorarios, tipoPersona: 'PN_RESIDENTE', base: '500.00', valorUt: '9' });
    expect(r.retencion).toBe('0.00');
    expect(r.bajoUmbral).toBe(true);
  });

  it('PJ domiciliada no lleva sustraendo (servicios 2%)', () => {
    const r = calcularRetencion1808({ concepto: servicios, tipoPersona: 'PJ_DOMICILIADA', base: '8000.00' });
    expect(r.sustraendo).toBe('0.00');
    expect(r.retencion).toBe('160.00');
  });

  it('exige valorUt cuando el concepto lleva sustraendo y la persona es PN', () => {
    expect(() => calcularRetencion1808({ concepto: honorarios, tipoPersona: 'PN_RESIDENTE', base: '10000' })).toThrow(/valorUt/);
  });

  it('respeta la porción gravable cuando el concepto retiene sobre una fracción de la base', () => {
    // Concepto parametrizado a 50% de base gravable, PJ 3% → base efectiva 5.000 × 3% = 150.
    const flete: ConceptoIslr1808 = { ...servicios, tarifaPjDomiciliada: '3', porcentajeBaseGravable: '50' };
    const r = calcularRetencion1808({ concepto: flete, tipoPersona: 'PJ_DOMICILIADA', base: '10000.00' });
    expect(r.base).toBe('5000.00');
    expect(r.basePago).toBe('10000.00');
    expect(r.retencion).toBe('150.00');
  });

  it('lanza si el concepto no tiene tarifa para el tipo de persona', () => {
    const soloPj: ConceptoIslr1808 = { ...honorarios, tarifaPnResidente: null };
    expect(() => calcularRetencion1808({ concepto: soloPj, tipoPersona: 'PN_RESIDENTE', base: '1000', valorUt: '9' })).toThrow(/no tiene tarifa/);
  });
});
