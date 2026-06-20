import { Asiento, verificarCuadre } from '@contave/ledger';
import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import { armarAsientoCompra, calcularCompra, type BorradorCompra } from './calculo-compra';

const FECHA = new Date('2026-06-12T12:00:00Z');

/** Compra Bs 1.000 + IVA 16% (160), una línea gravada. */
function compraBase(extra: Partial<BorradorCompra> = {}): BorradorCompra {
  return {
    moneda: 'VES',
    rateBcv: null,
    rateUsdMgmt: '40',
    cuentaDestino: '5.2',
    lineas: [
      { descripcion: 'Servicio', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
    ],
    ...extra,
  };
}

function asiento(b: BorradorCompra) {
  const calc = calcularCompra(b);
  const a = Asiento.construir(
    armarAsientoCompra(calc, {
      fecha: FECHA,
      descripcion: 'Compra',
      moneda: b.moneda,
      rateBcv: b.rateBcv,
      rateUsdMgmt: b.rateUsdMgmt,
      cuentaDestino: b.cuentaDestino,
    }),
  );
  return { calc, a };
}

describe('calcularCompra — retención de IVA (casos 26 y 27)', () => {
  it('caso 26 — retiene 75% del IVA (160 → 120); neto al proveedor 1.040', () => {
    const { calc, a } = asiento(compraBase({ retencionIva: { aplica: true, porcentaje: 75 } }));
    expect(calc.retencionIva.monto.ves).toBe('120.00');
    expect(calc.netoProveedor.ves).toBe('1040.00');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    // Acredita la retención de IVA por enterar a 2.3.03 y el neto a Proveedores (2.1).
    expect(a.lineas.some((l) => l.cuenta === '2.3.03' && l.dc === 'C')).toBe(true);
    const prov = a.lineas.find((l) => l.cuenta === '2.1' && l.dc === 'C');
    expect(prov?.montoVes.aDecimal().eq('1040')).toBe(true);
    // Debe: IVA crédito fiscal completo (160) a 1.3.01.
    const cred = a.lineas.find((l) => l.cuenta === '1.3.01' && l.dc === 'D');
    expect(cred?.montoVes.aDecimal().eq('160')).toBe(true);
  });

  it('caso 27 — retención 100% del IVA (160); neto 1.000', () => {
    const { calc, a } = asiento(compraBase({ retencionIva: { aplica: true, porcentaje: 100 } }));
    expect(calc.retencionIva.monto.ves).toBe('160.00');
    expect(calc.netoProveedor.ves).toBe('1000.00');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
  });

  it('sin agente de retención: no retiene, neto = total', () => {
    const { calc, a } = asiento(compraBase());
    expect(calc.retencionIva.aplica).toBe(false);
    expect(calc.netoProveedor.ves).toBe('1160.00');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '2.3.03')).toBe(false);
  });
});

describe('calcularCompra — retención de ISLR (caso 31)', () => {
  it('caso 31 — honorarios PN 3% con sustraendo 22,50 sobre base 10.000 → 277,50', () => {
    const b = compraBase({
      lineas: [
        { descripcion: 'Honorarios', cantidad: '1', precioUnitarioOrigen: '10000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      ],
      retencionIslr: { aplica: true, concepto: 'Honorarios profesionales', tarifa: '3', sustraendo: '22.50' },
    });
    const { calc, a } = asiento(b);
    expect(calc.retencionIslr.monto.ves).toBe('277.50');
    expect(calc.retencionIslr.concepto).toBe('Honorarios profesionales');
    // Neto = 10.000 − 277,50 (sin IVA en este ejemplo exento).
    expect(calc.netoProveedor.ves).toBe('9722.50');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    expect(a.lineas.some((l) => l.cuenta === '2.3.04' && l.dc === 'C')).toBe(true);
  });

  it('caso 32 — pago mixto: retiene ISLR solo sobre la línea de servicio discriminada', () => {
    const b = compraBase({
      lineas: [
        { descripcion: 'Mano de obra', cantidad: '1', precioUnitarioOrigen: '3000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
        { descripcion: 'Materiales', cantidad: '1', precioUnitarioOrigen: '7000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      ],
      retencionIslr: { aplica: true, concepto: 'Servicios', tarifa: '2', sustraendo: '0', lineasSujetas: [true, false] },
    });
    const { calc } = asiento(b);
    // Base ISLR = solo 3.000 (servicio) × 2% = 60; no toca los 7.000 de materiales.
    expect(calc.retencionIslr.base.ves).toBe('3000.00');
    expect(calc.retencionIslr.monto.ves).toBe('60.00');
    expect(calc.retencionIslr.baseSinDiscriminar).toBe(false);
  });

  it('caso 32 — sin discriminar: retiene sobre el total y marca la advertencia', () => {
    const b = compraBase({
      lineas: [
        { descripcion: 'Mano de obra', cantidad: '1', precioUnitarioOrigen: '3000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
        { descripcion: 'Materiales', cantidad: '1', precioUnitarioOrigen: '7000', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      ],
      retencionIslr: { aplica: true, concepto: 'Servicios', tarifa: '2', sustraendo: '0', lineasSujetas: [false, false] },
    });
    const { calc } = asiento(b);
    expect(calc.retencionIslr.base.ves).toBe('10000.00');
    expect(calc.retencionIslr.monto.ves).toBe('200.00');
    expect(calc.retencionIslr.baseSinDiscriminar).toBe(true);
  });

  it('IVA + ISLR juntos: ambos pasivos por enterar y asiento cuadrado', () => {
    const b = compraBase({
      retencionIva: { aplica: true, porcentaje: 75 },
      retencionIslr: { aplica: true, concepto: 'Servicios', tarifa: '2', sustraendo: '0', base: '1000' },
    });
    const { calc, a } = asiento(b);
    // IVA retenido 120 ; ISLR 1000×2% = 20 ; neto = 1160 − 120 − 20 = 1020.
    expect(calc.retencionIva.monto.ves).toBe('120.00');
    expect(calc.retencionIslr.monto.ves).toBe('20.00');
    expect(calc.netoProveedor.ves).toBe('1020.00');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
  });
});

describe('calcularCompra — multimoneda (USD)', () => {
  it('compra en USD: IVA crédito y retención en triple base, asiento cuadrado', () => {
    const b = compraBase({
      moneda: 'USD',
      rateBcv: '40',
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'Equipo', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
      retencionIva: { aplica: true, porcentaje: 75 },
    });
    const { calc, a } = asiento(b);
    // IVA $16 → retención 75% = $12 ; en Bs = 12 × 40 = 480.
    expect(calc.retencionIva.monto.origen).toBe('12.00');
    expect(calc.retencionIva.monto.ves).toBe('480.00');
    expect(verificarCuadre(a.lineas).balanceado).toBe(true);
    const total = new Decimal(calc.documento.totales.totalOrigen);
    const neto = new Decimal(calc.netoProveedor.origen);
    expect(total.minus(neto).eq('12')).toBe(true);
  });
});
