import { describe, expect, it } from 'vitest';
import { Asiento } from './asiento';
import { verificarCuadre } from './cuadre';
import { LineaAsiento } from './linea';
import { balancearConRedondeo } from './redondeo';

const FECHA = '2026-01-15T12:00:00.000Z';

describe('balancearConRedondeo — caso 9 (redondeo extremo, docs/07)', () => {
  // Origen USD cuadra exacto (D100 = C100); al convertir a VES con tasa de muchos decimales,
  // el redondeo por línea deja un residuo de Bs 0,01 que debe ajustarse, no descuadrar.
  const lineas = [
    { cuenta: '1.1.02', dc: 'D', moneda: 'USD', montoOrigen: '100', montoVes: '3612.35', montoUsdMgmt: '100' },
    { cuenta: '4.6', dc: 'C', moneda: 'USD', montoOrigen: '100', montoVes: '3612.34', montoUsdMgmt: '100' },
  ] as const;

  it('inserta una línea de ajuste que cuadra exactamente la base VES', () => {
    const balanceadas = balancearConRedondeo(lineas);
    expect(balanceadas).toHaveLength(3);
    const ajuste = balanceadas[2]!;
    expect(ajuste.esAjuste).toBe(true);
    expect(ajuste.cuenta).toBe('4.7'); // sobran débitos en VES → ganancia
    expect(ajuste.dc).toBe('C');
    expect(ajuste.montoVes).toBe('0.01');

    const cuadre = verificarCuadre(balanceadas.map((l) => LineaAsiento.desde(l)));
    expect(cuadre.balanceado).toBe(true);
  });

  it('el asiento resultante se construye sin descuadre', () => {
    const asiento = Asiento.construir({
      fecha: FECHA,
      descripcion: 'Venta USD con ajuste de redondeo',
      lineas: balancearConRedondeo(lineas),
    });
    expect(asiento.lineas).toHaveLength(3);
  });

  it('un residuo mayor que la tolerancia (no es redondeo) se rechaza', () => {
    const descuadradas = [
      { cuenta: '1.1.02', dc: 'D', moneda: 'USD', montoOrigen: '100', montoVes: '3700', montoUsdMgmt: '100' },
      { cuenta: '4.6', dc: 'C', moneda: 'USD', montoOrigen: '100', montoVes: '3612.34', montoUsdMgmt: '100' },
    ] as const;
    expect(() => balancearConRedondeo(descuadradas)).toThrow(/supera la tolerancia/);
  });

  it('no agrega líneas si ya cuadra exactamente', () => {
    const exactas = [
      { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '1' },
      { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '100', montoVes: '100', montoUsdMgmt: '1' },
    ] as const;
    expect(balancearConRedondeo(exactas)).toHaveLength(2);
  });

  it('ajusta también un residuo en la base USD gerencial', () => {
    const lineasUsd = [
      { cuenta: '1.1.01', dc: 'D', moneda: 'VES', montoOrigen: '3612', montoVes: '3612', montoUsdMgmt: '100.01' },
      { cuenta: '4.6', dc: 'C', moneda: 'VES', montoOrigen: '3612', montoVes: '3612', montoUsdMgmt: '100.00' },
    ] as const;
    const balanceadas = balancearConRedondeo(lineasUsd);
    expect(balanceadas).toHaveLength(3);
    const ajuste = balanceadas[2]!;
    expect(ajuste.moneda).toBe('USD');
    expect(ajuste.montoUsdMgmt).toBe('0.01');
    expect(ajuste.montoVes).toBe('0');
    expect(verificarCuadre(balanceadas.map((l) => LineaAsiento.desde(l))).balanceado).toBe(true);
  });
});
