import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { planDeCuentasBase } from '../cuentas/plan-base';
import type { MovimientoCuenta } from '../saldos/saldos';
import { estadoDeResultados, estadoDeSituacion, rollupPorNivel } from './estados-financieros';

function mov(
  cuenta: string,
  v: { dV?: string; hV?: string; dU?: string; hU?: string },
): MovimientoCuenta {
  return {
    cuenta,
    debeVes: Money.of(v.dV ?? '0', 'VES'),
    haberVes: Money.of(v.hV ?? '0', 'VES'),
    debeUsd: Money.of(v.dU ?? '0', 'USD'),
    haberUsd: Money.of(v.hU ?? '0', 'USD'),
  };
}

// Mini-libro POSTED coherente (cuadra en triple base):
//  1) Aporte de capital:  D 1.1.01 5000/172.41  C 3.1 5000/172.41
//  2) Venta gravada 16%:  D 1.2.01 1160/40  C 4.1 1000/34.48  C 2.3.01 160/5.52
//  3) Gasto de servicios: D 6.2 300/10.34  C 1.1.01 300/10.34
const LIBRO: MovimientoCuenta[] = [
  mov('1.1.01', { dV: '5000', dU: '172.41', hV: '300', hU: '10.34' }),
  mov('3.1', { hV: '5000', hU: '172.41' }),
  mov('1.2.01', { dV: '1160', dU: '40' }),
  mov('4.1', { hV: '1000', hU: '34.48' }),
  mov('2.3.01', { hV: '160', hU: '5.52' }),
  mov('6.2', { dV: '300', dU: '10.34' }),
];

describe('rollupPorNivel (P13)', () => {
  it('acumula el saldo en naturaleza hacia cada ancestro', () => {
    const r = rollupPorNivel(LIBRO);
    // Activo: 1.1.01 (deudor 4700) + 1.2.01 (deudor 1160) → 1.1 = 4700, 1 = 5860.
    expect(r.get('1.1.01')!.ves.igualA(Money.of('4700', 'VES'))).toBe(true);
    expect(r.get('1.1')!.ves.igualA(Money.of('4700', 'VES'))).toBe(true);
    expect(r.get('1')!.ves.igualA(Money.of('5860', 'VES'))).toBe(true);
    // Ingreso 4.1 acreedor → naturaleza positiva 1000.
    expect(r.get('4')!.ves.igualA(Money.of('1000', 'VES'))).toBe(true);
    expect(r.get('4')!.usd.igualA(Money.of('34.48', 'USD'))).toBe(true);
  });
});

describe('estadoDeResultados (P13, docs/03 §6)', () => {
  it('utilidad = Ingresos − Costos − Gastos en ambas bases', () => {
    const er = estadoDeResultados(LIBRO, planDeCuentasBase());
    expect(er.totalIngresosVes.igualA(Money.of('1000', 'VES'))).toBe(true);
    expect(er.totalCostosVes.igualA(Money.of('0', 'VES'))).toBe(true);
    expect(er.totalGastosVes.igualA(Money.of('300', 'VES'))).toBe(true);
    expect(er.utilidadVes.igualA(Money.of('700', 'VES'))).toBe(true);
    expect(er.utilidadUsd.igualA(Money.of('24.14', 'USD'))).toBe(true);
  });

  it('solo lista las secciones con movimiento (poda el catálogo)', () => {
    const er = estadoDeResultados(LIBRO, planDeCuentasBase());
    const ingreso = er.ingresos[0]!;
    expect(ingreso.cuenta).toBe('4');
    expect(ingreso.hijos.map((h) => h.cuenta)).toEqual(['4.1']);
    expect(er.costos).toHaveLength(0);
  });
});

describe('estadoDeSituacion (P13, docs/03 §6)', () => {
  it('Activo = Pasivo + Patrimonio (+ resultado del período) en ambas bases', () => {
    const er = estadoDeResultados(LIBRO, planDeCuentasBase());
    const es = estadoDeSituacion(LIBRO, planDeCuentasBase(), {
      ves: er.utilidadVes,
      usd: er.utilidadUsd,
    });
    expect(es.totalActivoVes.igualA(Money.of('5860', 'VES'))).toBe(true);
    expect(es.totalPasivoVes.igualA(Money.of('160', 'VES'))).toBe(true);
    expect(es.totalPatrimonioVes.igualA(Money.of('5700', 'VES'))).toBe(true);
    expect(es.cuadraVes).toBe(true);
    expect(es.cuadraUsd).toBe(true);
  });
});
