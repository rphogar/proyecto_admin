import { describe, expect, it } from 'vitest';
import { construirControlVerificable, type DatosControlVerificable } from './control-verificable';

const BASE: DatosControlVerificable = {
  rifEmisor: 'J-12345678-9',
  numeroControl: 'DIG-00000001',
  tipoDocumento: 'FACTURA',
  serie: 'A',
  numero: 42,
  fechaFiscal: '2026-06-12',
  rifAdquirente: 'J-98765432-1',
  totalVes: '2320.00',
  hashIntegridad: 'abc123',
  baseUrlVerificacion: 'https://verificar.contave.example/',
};

describe('construirControlVerificable (P24)', () => {
  it('es determinista: el mismo documento produce el mismo identificador', () => {
    expect(construirControlVerificable(BASE)).toEqual(construirControlVerificable(BASE));
  });

  it('el identificador cambia si cambia cualquier campo clave', () => {
    const base = construirControlVerificable(BASE).identificador;
    expect(construirControlVerificable({ ...BASE, totalVes: '2320.01' }).identificador).not.toBe(base);
    expect(construirControlVerificable({ ...BASE, numeroControl: 'DIG-00000002' }).identificador).not.toBe(base);
    expect(construirControlVerificable({ ...BASE, hashIntegridad: 'otro' }).identificador).not.toBe(base);
  });

  it('la URL de verificación lleva el número de control y el identificador, sin doble barra', () => {
    const c = construirControlVerificable(BASE);
    expect(c.urlVerificacion).toBe(
      `https://verificar.contave.example/verificar?c=DIG-00000001&id=${c.identificador}`,
    );
    expect(c.urlVerificacion).not.toContain('example//verificar');
    expect(c.qr).toBe(c.urlVerificacion);
  });

  it('consumidor final (sin RIF) no rompe la cadena canónica', () => {
    const c = construirControlVerificable({ ...BASE, rifAdquirente: null });
    expect(c.identificador).toMatch(/^[0-9a-f]{64}$/);
    expect(c.identificador).not.toBe(construirControlVerificable(BASE).identificador);
  });
});
