import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { Asiento } from '../asientos/asiento';
import { planDeCuentasBase } from '../cuentas/plan-base';
import { postear, reversar } from '../posting/posting';
import {
  balanceDeComprobacion,
  calcularMayor,
  saldoEnNaturalezaVes,
} from './saldos';

const FECHA = '2026-01-15T12:00:00.000Z';

function venta(id: string): Asiento {
  return Asiento.construir({
    id,
    fecha: FECHA,
    descripcion: 'Venta',
    lineas: [
      { cuenta: '1.2.01', dc: 'D', moneda: 'VES', montoOrigen: '1160', montoVes: '1160', montoUsdMgmt: '40' },
      { cuenta: '4.1', dc: 'C', moneda: 'VES', montoOrigen: '1000', montoVes: '1000', montoUsdMgmt: '34.48' },
      { cuenta: '2.3.01', dc: 'C', moneda: 'VES', montoOrigen: '160', montoVes: '160', montoUsdMgmt: '5.52' },
    ],
  });
}

describe('saldos derivados del ledger (regla 8, docs/05 §7.5)', () => {
  it('el mayor acumula debe/haber por cuenta solo de asientos POSTED', () => {
    const mayor = calcularMayor([postear(venta('a')), venta('b-draft')]);
    // 'b-draft' no está posteado: no cuenta.
    expect(mayor.get('1.2.01')!.debeVes.igualA(Money.of('1160', 'VES'))).toBe(true);
    expect(mayor.get('4.1')!.haberVes.igualA(Money.of('1000', 'VES'))).toBe(true);
  });

  it('saldo en naturaleza: deudor para activo, acreedor para ingreso', () => {
    const plan = planDeCuentasBase();
    const mayor = calcularMayor([postear(venta('a'))]);
    expect(
      saldoEnNaturalezaVes(mayor.get('1.2.01')!, plan.naturalezaDe('1.2.01')).igualA(
        Money.of('1160', 'VES'),
      ),
    ).toBe(true);
    expect(
      saldoEnNaturalezaVes(mayor.get('4.1')!, plan.naturalezaDe('4.1')).igualA(
        Money.of('1000', 'VES'),
      ),
    ).toBe(true);
  });

  it('el balance de comprobación cuadra (ΣdebeVES = ΣhaberVES)', () => {
    const bc = balanceDeComprobacion([postear(venta('a')), postear(venta('b'))]);
    expect(bc.cuadra).toBe(true);
    expect(bc.totalDebeVes.igualA(Money.of('2320', 'VES'))).toBe(true);
    expect(bc.totalDebeVes.igualA(bc.totalHaberVes)).toBe(true);
  });

  it('un asiento y su reverso netean a cero en el mayor', () => {
    const posted = postear(venta('a'));
    const reverso = postear(reversar(posted, { fecha: '2026-02-10T12:00:00.000Z', id: 'rev' }));
    const mayor = calcularMayor([posted, reverso]);
    for (const mov of mayor.values()) {
      expect(mov.debeVes.igualA(mov.haberVes)).toBe(true); // neto cero
    }
  });

  it('el cálculo es independiente del orden de los asientos (reconstructible)', () => {
    const a = postear(venta('a'));
    const b = postear(venta('b'));
    const m1 = balanceDeComprobacion([a, b]);
    const m2 = balanceDeComprobacion([b, a]);
    expect(m1.totalDebeVes.igualA(m2.totalDebeVes)).toBe(true);
  });
});
