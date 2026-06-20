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
  porcentajeRetencion: '75',
};

describe('generarTxtRetencionIva — formato del portal SENIAT', () => {
  it('una línea TAB-delimitada en el orden documentado (perfil clásico)', () => {
    const campos = generarTxtRetencionIva([base]).split('\t');
    expect(campos[0]).toBe('J-00000001-2'); // RIF agente
    expect(campos[1]).toBe('202606'); // período derivado del comprobante
    expect(campos[2]).toBe('J-12345678-9'); // RIF retenido
    expect(campos[3]).toBe('20260600000001'); // comprobante
    expect(campos[4]).toBe('10/06/2026'); // fecha DD/MM/AAAA
    expect(campos[5]).toBe('01'); // tipo transacción default
    expect(campos[6]).toBe('01'); // tipo documento default
    expect(campos[7]).toBe('1234'); // número documento
    expect(campos[8]).toBe('00-0001'); // número control
    expect(campos[10]).toBe('1160,00'); // total con IVA
    expect(campos[11]).toBe('0,00'); // compras sin crédito default
    expect(campos[12]).toBe('1000,00'); // base imponible
    expect(campos[13]).toBe('16'); // alícuota
    expect(campos[14]).toBe('160,00'); // IVA
    expect(campos[15]).toBe('120,00'); // IVA retenido
    expect(campos[16]).toBe('75'); // % retención
  });

  it('deriva el período del comprobante o usa el explícito', () => {
    const campos = generarTxtRetencionIva([{ ...base, periodo: '202605' }]).split('\t');
    expect(campos[1]).toBe('202605');
  });

  it('soporta el formato de fecha AAAA-MM-DD por opción', () => {
    const campos = generarTxtRetencionIva([base], { formatoFecha: 'AAAAMMDD' }).split('\t');
    expect(campos[4]).toBe('2026-06-10');
  });

  it('varias líneas separadas por CRLF', () => {
    expect(generarTxtRetencionIva([base, base]).split('\r\n')).toHaveLength(2);
  });

  it('rechaza fecha mal formada, período inválido y porcentaje inválido', () => {
    expect(() => generarTxtRetencionIva([{ ...base, fechaDocumento: '10-06-2026' }])).toThrow(/fecha/);
    expect(() => generarTxtRetencionIva([{ ...base, periodo: '2026' }])).toThrow(/período/);
    expect(() => generarTxtRetencionIva([{ ...base, porcentajeRetencion: '0' }])).toThrow(/porcentaje/);
  });
});
