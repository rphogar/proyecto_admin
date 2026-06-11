import { Money } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { planDeCuentasBase } from '../cuentas/plan-base';
import { Asiento } from './asiento';
import { AsientoDesbalanceadoError, verificarCuadre } from './cuadre';
import { LineaAsiento } from './linea';

// 2026-01-15 08:00 Caracas = 12:00Z (UTC−4).
const FECHA = '2026-01-15T12:00:00.000Z';

describe('Asiento — invariante ΣD=ΣC triple base (docs/03 §1)', () => {
  it('construye una venta simple en VES y deriva fecha fiscal y período (Caracas)', () => {
    const asiento = Asiento.construir({
      fecha: FECHA,
      descripcion: 'Venta gravada 16% en Bs',
      lineas: [
        { cuenta: '1.2.01', dc: 'D', moneda: 'VES', montoOrigen: '1160', montoVes: '1160', montoUsdMgmt: '40' },
        { cuenta: '4.1', dc: 'C', moneda: 'VES', montoOrigen: '1000', montoVes: '1000', montoUsdMgmt: '34.48' },
        { cuenta: '2.3.01', dc: 'C', moneda: 'VES', montoOrigen: '160', montoVes: '160', montoUsdMgmt: '5.52' },
      ],
    });
    expect(asiento.fechaFiscal).toBe('2026-01-15');
    expect(asiento.anio).toBe(2026);
    expect(asiento.mes).toBe(1);
    expect(asiento.estado).toBe('DRAFT');
    expect(asiento.totalDebeVes().igualA(Money.of('1160', 'VES'))).toBe(true);
    expect(asiento.totalHaberVes().igualA(Money.of('1160', 'VES'))).toBe(true);
  });

  it('rechaza un asiento que no cuadra en VES', () => {
    expect(() =>
      Asiento.construir({
        fecha: FECHA,
        descripcion: 'Descuadrado',
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '1' },
          { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '99', montoVes: '99', montoUsdMgmt: '1' },
        ],
      }),
    ).toThrow(AsientoDesbalanceadoError);
  });

  it('rechaza un asiento que cuadra en VES pero no en USD gerencial', () => {
    expect(() =>
      Asiento.construir({
        fecha: FECHA,
        descripcion: 'Cuadra VES, descuadra USD',
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '3' },
          { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '2' },
        ],
      }),
    ).toThrow(/USD/);
  });

  it('exige al menos dos líneas y ambos lados', () => {
    expect(() =>
      Asiento.construir({
        fecha: FECHA,
        descripcion: 'Una sola línea',
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '1', montoVes: '1', montoUsdMgmt: '1' },
        ],
      }),
    ).toThrow(/al menos dos líneas/);

    expect(() =>
      Asiento.construir({
        fecha: FECHA,
        descripcion: 'Solo débitos',
        lineas: [
          { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '1', montoVes: '1', montoUsdMgmt: '1' },
          { cuenta: '1.1.03', dc: 'D', moneda: 'VES', montoOrigen: '1', montoVes: '1', montoUsdMgmt: '1' },
        ],
      }),
    ).toThrow(/debe y una al haber/);
  });

  it('valida imputación solo a cuentas de movimiento cuando se pasa el plan', () => {
    const plan = planDeCuentasBase();
    expect(() =>
      Asiento.construir(
        {
          fecha: FECHA,
          descripcion: 'Imputa a totalizadora',
          lineas: [
            { cuenta: '1.1', dc: 'D', moneda: 'VES', montoOrigen: '10', montoVes: '10', montoUsdMgmt: '1' },
            { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '10', montoVes: '10', montoUsdMgmt: '1' },
          ],
        },
        { plan },
      ),
    ).toThrow(/totalizadora/);
  });

  it('rechaza montos negativos en una línea (el signo lo da D/C)', () => {
    expect(() =>
      LineaAsiento.desde({
        cuenta: '1.1.01',
        dc: 'D',
        moneda: 'VES',
        montoOrigen: '-1',
        montoVes: '-1',
        montoUsdMgmt: '-1',
      }),
    ).toThrow(/negativo/);
  });
});

describe('cuadre multimoneda con diferencial cambiario (docs/03 §4.2, caso 6)', () => {
  // Cobro de una CxC de $100 nacida a tasa 250 (Bs 25.000), cobrada a tasa 270 (Bs 27.000).
  // Origen USD cuadra (D100=C100); VES cuadra con la ganancia; USD gerencial sin diferencial.
  it('cuadra con la línea de diferencial marcada como ajuste (excluida del origen)', () => {
    const asiento = Asiento.construir({
      fecha: FECHA,
      descripcion: 'Cobro CxC USD con diferencial cambiario',
      lineas: [
        // Entra caja USD a tasa 270.
        { cuenta: '1.1.02', dc: 'D', moneda: 'USD', montoOrigen: '100', montoVes: '27000', montoUsdMgmt: '100', rateBcv: '270' },
        // Se salda la CxC a su VES original (tasa 250).
        { cuenta: '1.2.02', dc: 'C', moneda: 'USD', montoOrigen: '100', montoVes: '25000', montoUsdMgmt: '100', rateBcv: '250' },
        // Ganancia cambiaria: solo en base VES (ajuste, excluido del cuadre por origen).
        { cuenta: '4.7', dc: 'C', moneda: 'VES', montoOrigen: '2000', montoVes: '2000', montoUsdMgmt: '0', esAjuste: true },
      ],
    });
    const cuadre = verificarCuadre([...asiento.lineas]);
    expect(cuadre.balanceado).toBe(true);
  });

  it('sin marcar la línea de diferencial como ajuste, el cuadre por origen falla', () => {
    expect(() =>
      Asiento.construir({
        fecha: FECHA,
        descripcion: 'Diferencial sin marcar ajuste',
        lineas: [
          { cuenta: '1.1.02', dc: 'D', moneda: 'USD', montoOrigen: '100', montoVes: '27000', montoUsdMgmt: '100' },
          { cuenta: '1.2.02', dc: 'C', moneda: 'USD', montoOrigen: '100', montoVes: '25000', montoUsdMgmt: '100' },
          { cuenta: '4.7', dc: 'C', moneda: 'VES', montoOrigen: '2000', montoVes: '2000', montoUsdMgmt: '0' },
        ],
      }),
    ).toThrow(/ORIGEN/);
  });
});
