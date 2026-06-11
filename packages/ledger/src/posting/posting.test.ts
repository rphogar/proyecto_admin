import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { Asiento } from '../asientos/asiento';
import { planDeCuentasBase } from '../cuentas/plan-base';
import { LibroDePeriodos, PeriodoCerradoError } from '../periodos/periodo';
import { estaReversado, postear, reversar } from './posting';

const FECHA = '2026-01-15T12:00:00.000Z';

function ventaSimple(id?: string): Asiento {
  return Asiento.construir({
    ...(id !== undefined ? { id } : {}),
    companyId: 'co-1',
    fecha: FECHA,
    descripcion: 'Venta gravada 16% en Bs',
    lineas: [
      { cuenta: '1.2.01', dc: 'D', moneda: 'VES', montoOrigen: '1160', montoVes: '1160', montoUsdMgmt: '40' },
      { cuenta: '4.1', dc: 'C', moneda: 'VES', montoOrigen: '1000', montoVes: '1000', montoUsdMgmt: '34.48' },
      { cuenta: '2.3.01', dc: 'C', moneda: 'VES', montoOrigen: '160', montoVes: '160', montoUsdMgmt: '5.52' },
    ],
  });
}

describe('postear (regla 4, 7, 9)', () => {
  it('DRAFT → POSTED sin mutar el original', () => {
    const draft = ventaSimple();
    const posted = postear(draft);
    expect(posted.estado).toBe('POSTED');
    expect(draft.estado).toBe('DRAFT'); // original intacto
  });

  it('rechaza postear dos veces (POSTED es inmutable)', () => {
    const posted = postear(ventaSimple());
    expect(() => postear(posted)).toThrow(/ya está POSTED/);
  });

  it('valida imputación a cuentas de movimiento con el plan', () => {
    const plan = planDeCuentasBase();
    expect(() => postear(ventaSimple(), { plan })).not.toThrow();
  });

  it('rechaza postear con fecha en período cerrado (caso 42)', () => {
    const periodos = LibroDePeriodos.desde([{ anio: 2026, mes: 1, estado: 'CLOSED' }]);
    expect(() => postear(ventaSimple(), { periodos })).toThrow(PeriodoCerradoError);
  });

  it('permite postear en período abierto', () => {
    const periodos = LibroDePeriodos.desde([{ anio: 2026, mes: 1, estado: 'OPEN' }]);
    expect(postear(ventaSimple(), { periodos }).estado).toBe('POSTED');
  });
});

describe('reversar (asiento nuevo, original intacto)', () => {
  it('invierte D/C, enlaza reversalOf y deja el original sin tocar', () => {
    const posted = postear(ventaSimple('asiento-1'));
    const reverso = reversar(posted, { fecha: '2026-02-10T12:00:00.000Z', id: 'rev-1' });

    expect(reverso.estado).toBe('DRAFT');
    expect(reverso.reversalOf).toBe('asiento-1');
    expect(reverso.companyId).toBe('co-1');

    // Lados invertidos respecto del original.
    const origPorCuenta = new Map(posted.lineas.map((l) => [l.cuenta, l.dc]));
    for (const l of reverso.lineas) {
      expect(l.dc).not.toBe(origPorCuenta.get(l.cuenta));
    }
    // El reverso también cuadra (se construye con la misma validación).
    expect(reverso.totalDebeVes().igualA(Money.of('1160', 'VES'))).toBe(true);

    // El original permanece POSTED e inmutable.
    expect(posted.estado).toBe('POSTED');
  });

  it('solo reversa asientos POSTED y exige id en el original', () => {
    expect(() => reversar(ventaSimple('x'), { fecha: FECHA })).toThrow(/POSTED/);
    const sinId = postear(ventaSimple());
    expect(() => reversar(sinId, { fecha: FECHA })).toThrow(/necesita id/);
  });

  it('estaReversado se deriva de la existencia del reverso', () => {
    const posted = postear(ventaSimple('asiento-1'));
    const reverso = postear(reversar(posted, { fecha: '2026-02-10T12:00:00.000Z', id: 'rev-1' }));
    expect(estaReversado(posted, [posted, reverso])).toBe(true);
    expect(estaReversado(posted, [posted])).toBe(false);
  });
});
