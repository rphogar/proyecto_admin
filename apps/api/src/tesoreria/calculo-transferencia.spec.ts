import { Asiento, verificarCuadre } from '@contave/ledger';
import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { calcularTransferencia, type EntradaTransferencia } from './calculo-transferencia';

const FECHA = new Date('2026-06-12T12:00:00Z');

function asiento(e: EntradaTransferencia) {
  const r = calcularTransferencia(e);
  return { r, a: Asiento.construir(r.entradaAsiento) };
}

describe('calcularTransferencia — mismo signo de moneda (sin conversión)', () => {
  // Mover Bs 5.000 de banco (1.1.03) a caja Bs (1.1.01). Sin diferencial.
  const entrada: EntradaTransferencia = {
    fecha: FECHA,
    descripcion: 'Retiro a caja',
    origen: { cuenta: '1.1.03', moneda: 'VES', monto: '5000', rateBcv: null },
    destino: { cuenta: '1.1.01', moneda: 'VES', monto: '5000', rateBcv: null },
    rateUsdMgmt: '250',
  };

  it('cuadra en tres bases, D destino / C origen, sin diferencial', () => {
    const { r, a } = asiento(entrada);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '1.1.01' && l.dc === 'D')).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '1.1.03' && l.dc === 'C')).toBe(true);
    expect(new Decimal(r.diferencialVes).abs().lte('0.01')).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '4.7' || l.cuenta === '6.7')).toBe(false);
  });
});

describe('calcularTransferencia — conversión Bs→USD con diferencial (vender Bs / comprar USD)', () => {
  // Pago Bs 10.200 (banco) y recibo $40 en caja USD a tasa BCV 250 (valor 10.000). Ganancia 200 Bs.
  const entrada: EntradaTransferencia = {
    fecha: FECHA,
    descripcion: 'Compra de divisas',
    origen: { cuenta: '1.1.03', moneda: 'VES', monto: '10200', rateBcv: null },
    destino: { cuenta: '1.1.02', moneda: 'USD', monto: '40', rateBcv: '250' },
    rateUsdMgmt: '250',
  };

  it('cuadra en tres bases y registra el diferencial cambiario', () => {
    const { r, a } = asiento(entrada);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    // El valor VES de destino ($40×250=10.000) < origen (10.200) → pérdida 200 (entregué más Bs).
    expect(new Decimal(r.diferencialVes).toFixed(2)).toBe('-200.00');
    expect(a.lineas.some((l) => l.cuenta === '6.7' && l.esAjuste)).toBe(true);
  });

  it('la caja USD recibe $40 (origen) y el banco Bs entrega 10.200', () => {
    const { a } = asiento(entrada);
    const cajaUsd = a.lineas.find((l) => l.cuenta === '1.1.02' && l.dc === 'D');
    expect(cajaUsd?.montoOrigen.aDecimal().eq('40')).toBe(true);
    const banco = a.lineas.find((l) => l.cuenta === '1.1.03' && l.dc === 'C');
    expect(banco?.montoVes.aDecimal().eq('10200')).toBe(true);
  });
});

describe('calcularTransferencia — validaciones', () => {
  it('rechaza misma cuenta origen y destino', () => {
    expect(() =>
      calcularTransferencia({
        fecha: FECHA,
        descripcion: 'x',
        origen: { cuenta: '1.1.03', moneda: 'VES', monto: '100', rateBcv: null },
        destino: { cuenta: '1.1.03', moneda: 'VES', monto: '100', rateBcv: null },
        rateUsdMgmt: '250',
      }),
    ).toThrow(/misma cuenta/);
  });
});
