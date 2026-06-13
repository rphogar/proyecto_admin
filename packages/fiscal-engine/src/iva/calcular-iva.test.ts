import { describe, expect, it } from 'vitest';
import { calcularIvaDocumento } from './calcular-iva';

describe('calcularIvaDocumento — comportamiento y bordes', () => {
  it('documento vacío: todos los totales en cero', () => {
    expect(calcularIvaDocumento([])).toEqual({
      grupos: [],
      baseImponibleGravada: '0.00',
      ivaTotal: '0.00',
      baseExenta: '0.00',
      baseExportacion: '0.00',
      baseTotal: '0.00',
      total: '0.00',
    });
  });

  it('separa exento de exportación (columnas distintas del libro)', () => {
    const r = calcularIvaDocumento([
      { alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', cantidad: '1', precioUnitario: '100' },
      { alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '0', cantidad: '1', precioUnitario: '200' },
    ]);
    expect(r.baseExenta).toBe('100.00');
    expect(r.baseExportacion).toBe('200.00');
    expect(r.ivaTotal).toBe('0.00');
  });

  it('redondea half-up la base y calcula el IVA sobre la base ya redondeada', () => {
    // 1 × 100.005 → base 100.005 → half-up a 2 = 100.01 → IVA = 100.01 × 16% = 16.0016 → 16.00
    const r = calcularIvaDocumento([
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', cantidad: '1', precioUnitario: '100.005' },
    ]);
    expect(r.grupos[0]?.baseImponible).toBe('100.01');
    expect(r.grupos[0]?.iva).toBe('16.00');
  });

  it('una misma alícuota a dos tasas distintas produce dos renglones', () => {
    const r = calcularIvaDocumento([
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', cantidad: '1', precioUnitario: '100' },
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16.5', cantidad: '1', precioUnitario: '100' },
    ]);
    expect(r.grupos).toHaveLength(2);
    expect(r.ivaTotal).toBe('32.50');
  });

  it('permite otra cantidad de decimales (p.ej. 8) sin redondeo fiscal', () => {
    const r = calcularIvaDocumento(
      [{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', cantidad: '1', precioUnitario: '100.005' }],
      { decimales: 8 },
    );
    expect(r.grupos[0]?.baseImponible).toBe('100.00500000');
    expect(r.grupos[0]?.iva).toBe('16.00080000');
  });

  it('rechaza cantidad ≤ 0, tasa negativa y descuento mayor que el bruto', () => {
    expect(() =>
      calcularIvaDocumento([{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', cantidad: '0', precioUnitario: '100' }]),
    ).toThrow(/cantidad debe ser > 0/);
    expect(() =>
      calcularIvaDocumento([{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '-1', cantidad: '1', precioUnitario: '100' }]),
    ).toThrow(/no puede ser negativa/);
    expect(() =>
      calcularIvaDocumento([
        { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', cantidad: '1', precioUnitario: '100', descuento: '150' },
      ]),
    ).toThrow(/base negativa/);
  });
});
