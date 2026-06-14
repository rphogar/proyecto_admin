import { Asiento, verificarCuadre } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import { calcularArqueo, type EntradaArqueo } from './calculo-arqueo';

const FECHA = new Date('2026-06-12T23:00:00Z');

describe('calcularArqueo — caso 5 (arqueo por método refleja el movimiento real)', () => {
  // Turno que recibió un vuelto cruzado: efectivo USD entró por su método ($20), efectivo Bs salió.
  // El sistema espera por método; el arqueo físico declara lo contado. EFECTIVO_BS tiene un faltante.
  const entrada: EntradaArqueo = {
    fecha: FECHA,
    descripcion: 'Cierre de caja turno tarde',
    rateUsdMgmt: '250',
    conteos: [
      { paymentMethodId: 'pm-usd', cuenta: '1.1.02', moneda: 'USD', montoSistema: '20', montoDeclarado: '20', rateBcv: '250' },
      { paymentMethodId: 'pm-bs', cuenta: '1.1.01', moneda: 'VES', montoSistema: '10000', montoDeclarado: '9950', rateBcv: null },
      { paymentMethodId: 'pm-pm', cuenta: '1.1.03', moneda: 'VES', montoSistema: '5000', montoDeclarado: '5000', rateBcv: null },
    ],
  };

  it('calcula la diferencia por método (faltante de Bs 50)', () => {
    const r = calcularArqueo(entrada);
    const bs = r.diferencias.find((d) => d.paymentMethodId === 'pm-bs');
    expect(bs?.diferencia).toBe('-50.00');
    const usd = r.diferencias.find((d) => d.paymentMethodId === 'pm-usd');
    expect(usd?.diferencia).toBe('0.00');
    expect(r.totalDiferenciaVes).toBe('-50.00');
  });

  it('arma un asiento que cuadra: C caja Bs (1.1.01) / D faltante (6.8)', () => {
    const r = calcularArqueo(entrada);
    expect(r.entradaAsiento).toBeDefined();
    const a = Asiento.construir(r.entradaAsiento!);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '1.1.01' && l.dc === 'C')).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '6.8' && l.dc === 'D')).toBe(true);
  });
});

describe('calcularArqueo — sin diferencias', () => {
  it('no genera asiento cuando todo cuadra', () => {
    const r = calcularArqueo({
      fecha: FECHA,
      descripcion: 'Cierre exacto',
      rateUsdMgmt: '250',
      conteos: [{ paymentMethodId: 'pm-bs', cuenta: '1.1.01', moneda: 'VES', montoSistema: '8000', montoDeclarado: '8000', rateBcv: null }],
    });
    expect(r.entradaAsiento).toBeUndefined();
    expect(r.totalDiferenciaVes).toBe('0.00');
  });
});

describe('calcularArqueo — sobrante en USD', () => {
  it('D caja USD / C sobrante (4.6)', () => {
    const r = calcularArqueo({
      fecha: FECHA,
      descripcion: 'Sobrante',
      rateUsdMgmt: '250',
      conteos: [{ paymentMethodId: 'pm-usd', cuenta: '1.1.02', moneda: 'USD', montoSistema: '100', montoDeclarado: '105', rateBcv: '250' }],
    });
    const a = Asiento.construir(r.entradaAsiento!);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '1.1.02' && l.dc === 'D')).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '4.6' && l.dc === 'C')).toBe(true);
  });
});
