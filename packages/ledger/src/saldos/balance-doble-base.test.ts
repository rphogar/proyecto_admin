import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { planDeCuentasBase } from '../cuentas/plan-base';
import { balanceDeComprobacionDesdeMovimientos } from './balance-doble-base';
import type { MovimientoCuenta } from './saldos';

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

describe('balanceDeComprobacionDesdeMovimientos (P13, docs/03 §6)', () => {
  const movimientos: MovimientoCuenta[] = [
    mov('1.2.01', { dV: '1160', dU: '40' }),
    mov('4.1', { hV: '1000', hU: '34.48' }),
    mov('2.3.01', { hV: '160', hU: '5.52' }),
  ];

  it('cuadra en ambas bases (ΣD = ΣH en VES y en USD)', () => {
    const bc = balanceDeComprobacionDesdeMovimientos(movimientos);
    expect(bc.cuadraVes).toBe(true);
    expect(bc.cuadraUsd).toBe(true);
    expect(bc.totalDebeVes.igualA(Money.of('1160', 'VES'))).toBe(true);
    expect(bc.totalDebeVes.igualA(bc.totalHaberVes)).toBe(true);
    expect(bc.totalDebeUsd.igualA(Money.of('40', 'USD'))).toBe(true);
    expect(bc.totalDebeUsd.igualA(bc.totalHaberUsd)).toBe(true);
  });

  it('expone el saldo deudor por cuenta en ambas bases y anota la naturaleza con el plan', () => {
    const bc = balanceDeComprobacionDesdeMovimientos(movimientos, { plan: planDeCuentasBase() });
    const cliente = bc.filas.find((f) => f.cuenta === '1.2.01')!;
    expect(cliente.saldoDeudorVes.igualA(Money.of('1160', 'VES'))).toBe(true);
    expect(cliente.saldoDeudorUsd.igualA(Money.of('40', 'USD'))).toBe(true);
    expect(cliente.naturaleza).toBe('ACTIVO');
    const iva = bc.filas.find((f) => f.cuenta === '2.3.01')!;
    expect(iva.saldoDeudorVes.igualA(Money.of('-160', 'VES'))).toBe(true);
    expect(iva.naturaleza).toBe('PASIVO');
  });

  it('ordena las filas por código y es independiente del orden de entrada', () => {
    const bc1 = balanceDeComprobacionDesdeMovimientos(movimientos);
    const bc2 = balanceDeComprobacionDesdeMovimientos([...movimientos].reverse());
    expect(bc1.filas.map((f) => f.cuenta)).toEqual(['1.2.01', '2.3.01', '4.1']);
    expect(bc1.filas.map((f) => f.cuenta)).toEqual(bc2.filas.map((f) => f.cuenta));
  });
});
