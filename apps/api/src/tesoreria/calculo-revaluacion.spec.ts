import { Asiento, verificarCuadre } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import { calcularRevaluacion, type EntradaRevaluacion } from './calculo-revaluacion';

const FECHA = new Date('2026-05-31T20:00:00Z');

describe('calcularRevaluacion — caso 11 (saldos en divisas a tasa de cierre)', () => {
  // Caja USD $1.000 registrada a 250 (Bs 250.000). Tasa de cierre 270 → revaluación +20.000 (ganancia).
  const entrada: EntradaRevaluacion = {
    fecha: FECHA,
    descripcion: 'Revaluación de saldos en divisas 2026-05',
    rateCierre: '270',
    saldos: [{ cuenta: '1.1.02', moneda: 'USD', lado: 'D', saldoOrigen: '1000', vesEnLibros: '250000' }],
  };

  it('genera el ajuste de diferencial NO realizado: D caja USD / C ganancia (4.7)', () => {
    const r = calcularRevaluacion(entrada);
    expect(r.diferencialVes).toBe('20000.00');
    const a = Asiento.construir(r.entradaAsiento!);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    const caja = a.lineas.find((l) => l.cuenta === '1.1.02');
    expect(caja?.dc).toBe('D');
    expect(caja?.montoVes.aDecimal().eq('20000')).toBe(true);
    // Sólo cambia la base VES: el origen y la base USD del ajuste son 0.
    expect(caja?.montoOrigen.aDecimal().isZero()).toBe(true);
    expect(caja?.montoUsdMgmt.aDecimal().isZero()).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '4.7' && l.dc === 'C')).toBe(true);
  });

  it('es determinista (re-ejecutar da el mismo asiento → base de la idempotencia)', () => {
    const a = calcularRevaluacion(entrada);
    const b = calcularRevaluacion(entrada);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('calcularRevaluacion — pasivo en divisas (CxP) y saldos sin cambio', () => {
  it('CxP en USD que sube de tasa → pérdida (D 6.7 / C pasivo)', () => {
    const r = calcularRevaluacion({
      fecha: FECHA,
      descripcion: 'Revaluación CxP',
      rateCierre: '270',
      saldos: [{ cuenta: '2.1', moneda: 'USD', lado: 'C', saldoOrigen: '500', vesEnLibros: '125000' }],
    });
    const a = Asiento.construir(r.entradaAsiento!);
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '2.1' && l.dc === 'C')).toBe(true); // pasivo crece
    expect(a.lineas.some((l) => l.cuenta === '6.7' && l.dc === 'D')).toBe(true); // pérdida
    expect(r.diferencialVes).toBe('-10000.00');
  });

  it('ignora saldos en VES y no genera asiento si nada cambia', () => {
    const r = calcularRevaluacion({
      fecha: FECHA,
      descripcion: 'sin efecto',
      rateCierre: '270',
      saldos: [
        { cuenta: '1.1.01', moneda: 'VES', lado: 'D', saldoOrigen: '50000', vesEnLibros: '50000' },
        { cuenta: '1.1.02', moneda: 'USD', lado: 'D', saldoOrigen: '100', vesEnLibros: '27000' },
      ],
    });
    expect(r.entradaAsiento).toBeUndefined();
    expect(r.diferencialVes).toBe('0.00');
  });
});
