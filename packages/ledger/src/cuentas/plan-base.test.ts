import { describe, expect, it } from 'vitest';
import {
  CUENTA_GANANCIA_CAMBIARIA,
  CUENTA_PERDIDA_CAMBIARIA,
  PLAN_DE_CUENTAS_BASE,
  planDeCuentasBase,
} from './plan-base';

describe('plan de cuentas base (docs/03 §2)', () => {
  it('construye un árbol válido (códigos únicos, padres presentes, clases 1–6)', () => {
    expect(() => planDeCuentasBase()).not.toThrow();
  });

  it('tiene las seis clases raíz con su naturaleza', () => {
    const plan = planDeCuentasBase();
    expect(plan.raices().map((c) => c.codigo).sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(plan.naturalezaDe('1')).toBe('ACTIVO');
    expect(plan.naturalezaDe('2')).toBe('PASIVO');
    expect(plan.naturalezaDe('3')).toBe('PATRIMONIO');
    expect(plan.naturalezaDe('4')).toBe('INGRESO');
    expect(plan.naturalezaDe('5')).toBe('COSTO');
    expect(plan.naturalezaDe('6')).toBe('GASTO');
  });

  it('las cuentas con hijas son totalizadoras; las hojas son de movimiento', () => {
    const plan = planDeCuentasBase();
    // Totalizadoras conocidas:
    for (const tot of ['1', '1.1', '1.2', '1.3', '2', '2.3', '2.4', '3', '4', '5', '6']) {
      expect(plan.esMovimiento(tot)).toBe(false);
    }
    // Movimiento conocidas:
    for (const mov of ['1.1.01', '1.1.06', '2.3.01', '2.4.09', '4.7', '6.7', '5.1', '3.2']) {
      expect(plan.esMovimiento(mov)).toBe(true);
    }
  });

  it('todas las cuentas son de sistema', () => {
    expect(PLAN_DE_CUENTAS_BASE.every((c) => c.esSistema === true)).toBe(true);
  });

  it('las cuentas de divisa declaran su moneda', () => {
    const plan = planDeCuentasBase();
    expect(plan.requerirCuenta('1.1.02').moneda).toBe('USD');
    expect(plan.requerirCuenta('1.1.06').moneda).toBe('USDT');
    expect(plan.requerirCuenta('1.2.02').moneda).toBe('USD');
    expect(plan.requerirCuenta('1.1.01').moneda).toBe('VES');
  });

  it('las cuentas de diferencial cambiario existen y son de movimiento', () => {
    const plan = planDeCuentasBase();
    expect(plan.esMovimiento(CUENTA_GANANCIA_CAMBIARIA)).toBe(true);
    expect(plan.naturalezaDe(CUENTA_GANANCIA_CAMBIARIA)).toBe('INGRESO');
    expect(plan.esMovimiento(CUENTA_PERDIDA_CAMBIARIA)).toBe(true);
    expect(plan.naturalezaDe(CUENTA_PERDIDA_CAMBIARIA)).toBe('GASTO');
  });
});
