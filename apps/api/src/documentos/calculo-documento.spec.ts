import { Asiento, verificarCuadre } from '@contave/ledger';
import { Decimal } from '@contave/shared';
import { describe, expect, it } from 'vitest';
import {
  armarAsientoFacturaVenta,
  type BorradorCalculo,
  calcularDocumento,
} from './calculo-documento';

describe('calcularDocumento (P6)', () => {
  it('factura en VES con una línea 16%: base, IVA y total correctos', () => {
    const borrador: BorradorCalculo = {
      tipo: 'FACTURA',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'Servicio', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
    };
    const calc = calcularDocumento(borrador);
    expect(calc.impuestos).toHaveLength(1);
    expect(calc.impuestos[0]).toMatchObject({ alicuotaCodigo: 'GENERAL', baseVes: '1000.00', montoVes: '160.00' });
    expect(calc.totales.totalVes).toBe('1160.00');
    // En VES, la base gerencial USD = VES / tasa gerencial.
    expect(calc.totales.totalUsdMgmt).toBe('29.00'); // 1160 / 40
  });

  it('factura en USD: base fiscal VES vía rateBcv, base gerencial USD = origen', () => {
    const borrador: BorradorCalculo = {
      tipo: 'FACTURA',
      moneda: 'USD',
      rateBcv: '40',
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'Producto', cantidad: '2', precioUnitarioOrigen: '50', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
    };
    const calc = calcularDocumento(borrador);
    expect(calc.totales.totalOrigen).toBe('116.00'); // 100 + 16 USD
    expect(calc.totales.totalUsdMgmt).toBe('116.00'); // USD origen = USD gerencial
    expect(calc.totales.totalVes).toBe('4640.00'); // 116 * 40
  });

  it('discrimina varias alícuotas (16%, 8% y exento) — caso 12', () => {
    const borrador: BorradorCalculo = {
      tipo: 'FACTURA',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'A', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
        { descripcion: 'B', cantidad: '1', precioUnitarioOrigen: '500', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
        { descripcion: 'C', cantidad: '1', precioUnitarioOrigen: '200', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      ],
    };
    const calc = calcularDocumento(borrador);
    expect(calc.impuestos.map((t) => t.alicuotaCodigo)).toEqual(['EXENTO', 'GENERAL', 'REDUCIDA']);
    const general = calc.impuestos.find((t) => t.alicuotaCodigo === 'GENERAL');
    const reducida = calc.impuestos.find((t) => t.alicuotaCodigo === 'REDUCIDA');
    const exento = calc.impuestos.find((t) => t.alicuotaCodigo === 'EXENTO');
    expect(general?.montoVes).toBe('160.00');
    expect(reducida?.montoVes).toBe('40.00');
    expect(exento?.montoVes).toBe('0.00');
    // Total = 1700 base + 200 IVA = 1900.
    expect(calc.totales.totalVes).toBe('1900.00');
  });

  it('aplica descuento de línea a la base', () => {
    const calc = calcularDocumento({
      tipo: 'FACTURA',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'X', cantidad: '10', precioUnitarioOrigen: '100', descuentoOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      ],
    });
    expect(calc.impuestos[0]?.baseVes).toBe('900.00'); // 1000 - 100
    expect(calc.totales.totalVes).toBe('1044.00'); // 900 + 144
  });

  it('rechaza un descuento mayor que el subtotal', () => {
    expect(() =>
      calcularDocumento({
        tipo: 'FACTURA',
        moneda: 'VES',
        rateBcv: null,
        rateUsdMgmt: '40',
        lineas: [{ descripcion: 'X', cantidad: '1', precioUnitarioOrigen: '100', descuentoOrigen: '200', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      }),
    ).toThrow(/base negativa/i);
  });
});

describe('armarAsientoFacturaVenta (P6)', () => {
  function calcUsd() {
    return calcularDocumento({
      tipo: 'FACTURA',
      moneda: 'USD',
      rateBcv: '40',
      rateUsdMgmt: '40',
      lineas: [
        { descripcion: 'A', cantidad: '1', precioUnitarioOrigen: '100', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
        { descripcion: 'B', cantidad: '1', precioUnitarioOrigen: '50', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
      ],
    });
  }

  it('cuadra en las tres bases (D Clientes = C Ventas + C IVA)', () => {
    const calc = calcUsd();
    const entrada = armarAsientoFacturaVenta(calc, {
      fecha: new Date('2026-06-12T12:00:00Z'),
      descripcion: 'Factura de prueba',
      moneda: 'USD',
      rateBcv: '40',
      rateUsdMgmt: '40',
    });
    // Asiento.construir valida ΣD=ΣC en las tres bases; no debe lanzar.
    const asiento = Asiento.construir(entrada);
    const cuadre = verificarCuadre(asiento.lineas);
    expect(cuadre.balanceado).toBe(true);

    // Debe: Clientes divisas por el total.
    const debe = asiento.lineas.filter((l) => l.dc === 'D');
    expect(debe).toHaveLength(1);
    expect(debe[0]?.cuenta).toBe('1.2.02');
    // Money.aCadenaDecimal() es canónico (sin ceros de relleno); comparamos numéricamente.
    expect(debe[0]?.montoOrigen.aDecimal().eq(calc.totales.totalOrigen)).toBe(true);

    // Haber: 4.1 (16%), 4.2 (8%) y 2.3.01 (IVA).
    const cuentasHaber = asiento.lineas.filter((l) => l.dc === 'C').map((l) => l.cuenta).sort();
    expect(cuentasHaber).toEqual(['2.3.01', '4.1', '4.2']);
  });

  it('en VES usa la cuenta de clientes en bolívares (1.2.01)', () => {
    const calc = calcularDocumento({
      tipo: 'FACTURA',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [{ descripcion: 'A', cantidad: '1', precioUnitarioOrigen: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
    });
    const asiento = Asiento.construir(
      armarAsientoFacturaVenta(calc, { fecha: new Date('2026-06-12T12:00:00Z'), descripcion: 'F', moneda: 'VES', rateBcv: null, rateUsdMgmt: '40' }),
    );
    expect(asiento.lineas.find((l) => l.dc === 'D')?.cuenta).toBe('1.2.01');
  });

  it('una factura 100% exenta no genera línea de IVA débito', () => {
    const calc = calcularDocumento({
      tipo: 'FACTURA',
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '40',
      lineas: [{ descripcion: 'Medicina', cantidad: '1', precioUnitarioOrigen: '500', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' }],
    });
    const asiento = Asiento.construir(
      armarAsientoFacturaVenta(calc, { fecha: new Date('2026-06-12T12:00:00Z'), descripcion: 'F', moneda: 'VES', rateBcv: null, rateUsdMgmt: '40' }),
    );
    expect(asiento.lineas.some((l) => l.cuenta === '2.3.01')).toBe(false);
    expect(new Decimal(calc.totales.totalVes).toFixed()).toBe('500');
  });
});
