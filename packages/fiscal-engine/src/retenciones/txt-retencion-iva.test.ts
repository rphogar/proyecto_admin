import { describe, expect, it } from 'vitest';
import { generarTxtRetencionIva, type LineaRetencionIvaTxt } from './txt-retencion-iva';

const base: LineaRetencionIvaTxt = {
  rifAgente: 'J-00000001-2',
  rifRetenido: 'J-12345678-9',
  numeroComprobante: '20260600000001',
  fechaDocumento: '2026-06-10',
  numeroDocumento: '1234',
  numeroControl: '00-0001',
  totalCompraConIva: '1160.00',
  baseImponible: '1000.00',
  alicuota: '16',
  impuestoIva: '160.00',
  ivaRetenido: '120.00',
};

describe('generarTxtRetencionIva — formato del portal SENIAT', () => {
  it('una línea TAB-delimitada con montos en coma decimal y fecha DD/MM/AAAA', () => {
    const txt = generarTxtRetencionIva([base]);
    const campos = txt.split('\t');
    expect(campos[0]).toBe('J-00000001-2');
    expect(campos[1]).toBe('J-12345678-9');
    expect(campos[2]).toBe('20260600000001');
    expect(campos[3]).toBe('10/06/2026');
    expect(campos[4]).toBe('01'); // tipo transacción default
    expect(campos[5]).toBe('01'); // tipo documento default
    expect(campos[9]).toBe('1160,00'); // total con IVA
    expect(campos[11]).toBe('1000,00'); // base imponible
    expect(campos[12]).toBe('16'); // alícuota
    expect(campos[13]).toBe('160,00'); // IVA
    expect(campos[14]).toBe('120,00'); // IVA retenido
  });

  it('varias líneas separadas por CRLF', () => {
    const txt = generarTxtRetencionIva([base, base]);
    expect(txt.split('\r\n')).toHaveLength(2);
  });

  it('compras sin crédito por defecto en 0,00', () => {
    const campos = generarTxtRetencionIva([base]).split('\t');
    expect(campos[10]).toBe('0,00');
  });

  it('rechaza fecha mal formada', () => {
    expect(() => generarTxtRetencionIva([{ ...base, fechaDocumento: '10-06-2026' }])).toThrow(/fecha/);
  });
});
