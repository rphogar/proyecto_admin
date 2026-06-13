import { Asiento, verificarCuadre } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import { calcularDocumento } from './calculo-documento';
import { armarAsientoNotaCredito } from './calculo-nota';

/**
 * NOTA DE CRÉDITO — caso 8 del doc 07: devolución (NC) en divisas a una tasa distinta a la de la
 * factura original. La NC usa la tasa de SU fecha; el neto fiscal por alícuota sale correcto.
 */
describe('armarAsientoNotaCredito (P8) — caso 8', () => {
  function calcDevolucion(rateBcv: string) {
    // Devolución de la línea 16% de una factura en USD, a la tasa de la fecha de la NC.
    return calcularDocumento({
      tipo: 'NOTA_CREDITO',
      moneda: 'USD',
      rateBcv,
      rateUsdMgmt: rateBcv,
      lineas: [{ descripcion: 'Devolución producto', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
    });
  }

  it('la NC usa la tasa de su fecha (270), no la de la factura (250)', () => {
    const calc = calcDevolucion('270');
    // Base $100, IVA $16, total $116 → en VES a 270.
    expect(calc.impuestos[0]?.baseVes).toBe('27000.00'); // 100 * 270
    expect(calc.impuestos[0]?.montoVes).toBe('4320.00'); // 16 * 270
    expect(calc.totales.totalVes).toBe('31320.00'); // 116 * 270
    expect(calc.totales.totalOrigen).toBe('116.00');
  });

  it('invierte los lados de la factura y cuadra en las tres bases', () => {
    const calc = calcDevolucion('270');
    const asiento = Asiento.construir(
      armarAsientoNotaCredito(calc, {
        fecha: new Date('2026-06-12T12:00:00Z'),
        descripcion: 'NC devolución',
        moneda: 'USD',
        rateBcv: '270',
        rateUsdMgmt: '270',
        partyId: undefined,
      }),
    );
    expect(verificarCuadre(asiento.lineas).balanceado).toBe(true);

    // Debe: ventas (4.1) + IVA débito (2.3.01). Haber: clientes divisas (1.2.02) por el total.
    const debe = asiento.lineas.filter((l) => l.dc === 'D').map((l) => l.cuenta).sort();
    expect(debe).toEqual(['2.3.01', '4.1']);
    const haber = asiento.lineas.filter((l) => l.dc === 'C');
    expect(haber).toHaveLength(1);
    expect(haber[0]?.cuenta).toBe('1.2.02');
    expect(haber[0]?.montoVes.aDecimal().eq('31320')).toBe(true);
    expect(asiento.sourceType).toBe('NOTA_CREDITO');
  });

  it('NC parcial 100% exenta no reversa IVA', () => {
    const calc = calcularDocumento({
      tipo: 'NOTA_CREDITO',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [{ descripcion: 'Medicina', cantidad: '1', precioUnitarioOrigen: '500', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
    });
    const asiento = Asiento.construir(
      armarAsientoNotaCredito(calc, { fecha: new Date('2026-06-12T12:00:00Z'), descripcion: 'NC', moneda: 'VES', rateBcv: null, rateUsdMgmt: '40' }),
    );
    expect(asiento.lineas.some((l) => l.cuenta === '2.3.01')).toBe(false);
    expect(asiento.lineas.find((l) => l.dc === 'C')?.cuenta).toBe('1.2.01');
  });
});
