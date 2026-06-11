import { describe, expect, it } from 'vitest';
import { PlanDeCuentas } from './plan-de-cuentas';

describe('PlanDeCuentas (docs/03 §2)', () => {
  const defs = [
    { codigo: '1', nombre: 'ACTIVO' },
    { codigo: '1.1', nombre: 'Efectivo y equivalentes' },
    { codigo: '1.1.01', nombre: 'Caja Bs' },
    { codigo: '1.1.02', nombre: 'Caja USD efectivo', moneda: 'USD' },
    { codigo: '4', nombre: 'INGRESOS' },
    { codigo: '4.1', nombre: 'Ventas gravadas 16%' },
  ];

  it('construye el árbol y deriva naturaleza/nivel/padre del código', () => {
    const plan = PlanDeCuentas.desde(defs);
    const caja = plan.requerirCuenta('1.1.01');
    expect(caja.naturaleza).toBe('ACTIVO');
    expect(caja.nivel).toBe(3);
    expect(caja.codigoPadre).toBe('1.1');
    expect(plan.requerirCuenta('4.1').naturaleza).toBe('INGRESO');
  });

  it('marca como movimiento solo las hojas; las superiores totalizan', () => {
    const plan = PlanDeCuentas.desde(defs);
    expect(plan.esMovimiento('1.1.01')).toBe(true);
    expect(plan.esMovimiento('1.1.02')).toBe(true);
    expect(plan.esMovimiento('4.1')).toBe(true);
    expect(plan.esMovimiento('1.1')).toBe(false); // tiene hijas
    expect(plan.esMovimiento('1')).toBe(false);
    expect(plan.esMovimiento('4')).toBe(false);
  });

  it('expone hijos, raíces y cuentas de movimiento', () => {
    const plan = PlanDeCuentas.desde(defs);
    expect(plan.hijos('1.1').map((c) => c.codigo)).toEqual(['1.1.01', '1.1.02']);
    expect(plan.raices().map((c) => c.codigo).sort()).toEqual(['1', '4']);
    expect(plan.cuentasDeMovimiento().map((c) => c.codigo).sort()).toEqual([
      '1.1.01',
      '1.1.02',
      '4.1',
    ]);
  });

  it('conserva la moneda funcional declarada', () => {
    const plan = PlanDeCuentas.desde(defs);
    expect(plan.requerirCuenta('1.1.02').moneda).toBe('USD');
    expect(plan.requerirCuenta('1.1.01').moneda).toBeUndefined();
  });

  it('rechaza códigos duplicados', () => {
    expect(() =>
      PlanDeCuentas.desde([
        { codigo: '1', nombre: 'A' },
        { codigo: '1', nombre: 'B' },
      ]),
    ).toThrow(/duplicado/);
  });

  it('rechaza una cuenta con padre inexistente', () => {
    expect(() =>
      PlanDeCuentas.desde([{ codigo: '1.1.01', nombre: 'Caja Bs' }]),
    ).toThrow(/padre inexistente/);
  });

  it('rechaza una clase inválida (derivada del código)', () => {
    expect(() => PlanDeCuentas.desde([{ codigo: '7', nombre: 'Inexistente' }])).toThrow(
      /Clase de cuenta inválida/,
    );
  });

  it('requerirCuenta lanza para códigos ausentes', () => {
    const plan = PlanDeCuentas.desde(defs);
    expect(() => plan.requerirCuenta('9.9')).toThrow(/inexistente/i);
  });
});
