import { describe, expect, it } from 'vitest';
import { type FilaImpuestoLibro, resumirLibro } from './resumen-libro';

describe('resumirLibro — resumen del Libro de Ventas/Compras (Reglamento IVA arts. 70–78)', () => {
  it('suma facturas por alícuota y separa exentas y exportación', () => {
    const filas: FilaImpuestoLibro[] = [
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '1000.00', monto: '160.00', factor: 1 },
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '500.00', monto: '80.00', factor: 1 },
      { alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8', base: '200.00', monto: '16.00', factor: 1 },
      { alicuotaCodigo: 'EXENTO', alicuotaTasa: '0', base: '300.00', monto: '0', factor: 1 },
      { alicuotaCodigo: 'EXPORTACION', alicuotaTasa: '0', base: '400.00', monto: '0', factor: 1 },
    ];
    const r = resumirLibro(filas);
    expect(r.grupos).toEqual([
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '1500.00', monto: '240.00' },
      { alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8', base: '200.00', monto: '16.00' },
    ]);
    expect(r.baseGravada).toBe('1700.00');
    expect(r.ivaTotal).toBe('256.00');
    expect(r.baseExenta).toBe('300.00');
    expect(r.baseExportacion).toBe('400.00');
    expect(r.baseTotal).toBe('2400.00');
    expect(r.totalConIva).toBe('2656.00');
  });

  it('la nota de crédito (factor −1) resta del neto del período (caso 8/17)', () => {
    const filas: FilaImpuestoLibro[] = [
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '1000.00', monto: '160.00', factor: 1 },
      { alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '250.00', monto: '40.00', factor: -1 },
    ];
    const r = resumirLibro(filas);
    expect(r.grupos[0]).toEqual({ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '750.00', monto: '120.00' });
    expect(r.ivaTotal).toBe('120.00');
  });

  it('rechaza factor inválido', () => {
    expect(() => resumirLibro([{ alicuotaCodigo: 'GENERAL', alicuotaTasa: '16', base: '1', monto: '0', factor: 2 as unknown as 1 }])).toThrow(
      /factor/,
    );
  });

  it('libro vacío → todo en cero', () => {
    const r = resumirLibro([]);
    expect(r).toEqual({
      grupos: [],
      baseGravada: '0.00',
      ivaTotal: '0.00',
      baseExenta: '0.00',
      baseExportacion: '0.00',
      baseTotal: '0.00',
      totalConIva: '0.00',
    });
  });
});
