import { Asiento, verificarCuadre } from '@contave/ledger';
import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { calcularCobro, calcularVuelto, type EntradaCobro } from './calculo-cobro';

const FECHA = new Date('2026-06-12T12:00:00Z');

function asiento(e: EntradaCobro) {
  const r = calcularCobro(e);
  const a = Asiento.construir(r.entradaAsiento);
  return { r, a };
}

describe('calcularCobro — caso 4 (pago mixto + IGTF)', () => {
  // Factura $100 (CxC divisas, nacida a 250). Cliente paga Bs 10.000 (=$40 a 250) + $60 Zelle.
  // IGTF sólo sobre $60 → $1,80. El asiento cuadra en las 3 bases.
  const entrada: EntradaCobro = {
    fecha: FECHA,
    descripcion: 'Cobro mixto factura $100',
    saldo: { cuenta: '1.2.02', moneda: 'USD', rateCarryBcv: '250' },
    rateUsdMgmt: '250',
    empresaEsPerceptor: true,
    medios: [
      { cuenta: '1.1.03', moneda: 'VES', montoOrigen: '10000', esDivisa: false, rateBcv: null },
      { cuenta: '1.1.05', moneda: 'USD', montoOrigen: '60', esDivisa: true, rateBcv: '250' },
    ],
  };

  it('IGTF se causa sólo sobre los $60 en divisas → $1,80', () => {
    const { r } = asiento(entrada);
    expect(r.igtf.aplica).toBe(true);
    expect(r.igtf.detalle[0]?.igtf).toBe('1.80');
    expect(r.igtf.igtfTotalVes).toBe('450.00'); // 1.80 * 250
  });

  it('el asiento cuadra en las tres bases y acredita IGTF a 2.3.05', () => {
    const { a } = asiento(entrada);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '2.3.05' && l.dc === 'C')).toBe(true);
    // CxC ($100) acreditada: Bs 10.000 (=$40) + $60.
    const cxc = a.lineas.filter((l) => l.cuenta === '1.2.02' && l.dc === 'C');
    const cxcUsd = cxc.reduce((s, l) => s.plus(l.montoUsdMgmt.aDecimal()), new Decimal(0));
    expect(cxcUsd.eq('100')).toBe(true);
  });

  it('a tasa de carga = tasa de cobro no hay diferencial', () => {
    const { r } = asiento(entrada);
    expect(new Decimal(r.diferencialVes).abs().lte('0.01')).toBe(true);
  });
});

describe('calcularCobro — caso 6 (CxC USD cobrada a tasa mayor: diferencial)', () => {
  // CxC $100 nacida a 250, cobrada semanas después a 270 → ganancia en VES, 0 en USD.
  const entrada: EntradaCobro = {
    fecha: FECHA,
    descripcion: 'Cobro CxC USD a 270',
    saldo: { cuenta: '1.2.02', moneda: 'USD', rateCarryBcv: '250' },
    rateUsdMgmt: '270',
    empresaEsPerceptor: false,
    medios: [{ cuenta: '1.1.05', moneda: 'USD', montoOrigen: '100', esDivisa: true, rateBcv: '270' }],
  };

  it('registra ganancia cambiaria en VES (4.7) por (270−250)·100 = 2.000', () => {
    const { r, a } = asiento(entrada);
    expect(r.diferencialVes).toBe('2000.00');
    const ganancia = a.lineas.find((l) => l.cuenta === '4.7');
    expect(ganancia?.dc).toBe('C');
    expect(ganancia?.montoVes.aDecimal().eq('2000')).toBe(true);
    expect(ganancia?.esAjuste).toBe(true);
  });

  it('no percibe IGTF (empresa no es perceptor) y cuadra en las tres bases', () => {
    const { r, a } = asiento(entrada);
    expect(r.igtf.aplica).toBe(false);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    // En la base USD no hay diferencial: D Caja USD 100 = C CxC 100.
    const cajaUsd = a.lineas.find((l) => l.cuenta === '1.1.05' && l.dc === 'D');
    const cxcUsd = a.lineas.find((l) => l.cuenta === '1.2.02' && l.dc === 'C');
    expect(cajaUsd?.montoUsdMgmt.aDecimal().eq('100')).toBe(true);
    expect(cxcUsd?.montoUsdMgmt.aDecimal().eq('100')).toBe(true);
  });
});

describe('calcularVuelto — caso 5 (vuelto cruzado)', () => {
  it('compra $14,50 pagada con $20 → vuelto $5,50 y su equivalente en Bs', () => {
    // A tasa 100: total 1450 Bs, pagado 2000 Bs → vuelto 550 Bs = $5,50.
    const v = calcularVuelto('1450', '2000', '100');
    expect(v.vueltoVes).toBe('550.00');
    expect(v.vueltoUsd).toBe('5.50');
  });

  it('sin excedente, el vuelto es cero', () => {
    expect(calcularVuelto('1450', '1450', '100')).toEqual({ vueltoVes: '0.00', vueltoUsd: '0.00' });
  });

  it('el asiento de un cobro con vuelto en la misma moneda cuadra (arqueo real)', () => {
    // Compra $14,50, tendió $20 USD, vuelto $5,50 USD. CxC en USD a 100.
    const { a } = asiento({
      fecha: FECHA,
      descripcion: 'Cobro POS con vuelto',
      saldo: { cuenta: '1.2.02', moneda: 'USD', rateCarryBcv: '100' },
      rateUsdMgmt: '100',
      empresaEsPerceptor: false,
      medios: [{ cuenta: '1.1.02', moneda: 'USD', montoOrigen: '20', esDivisa: true, rateBcv: '100' }],
      vuelto: [{ cuenta: '1.1.02', moneda: 'USD', montoOrigen: '5.50', rateBcv: '100' }],
    });
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    // CxC acreditada por el neto $14,50.
    const cxc = a.lineas.find((l) => l.cuenta === '1.2.02' && l.dc === 'C');
    expect(cxc?.montoUsdMgmt.aDecimal().eq('14.5')).toBe(true);
  });
});
