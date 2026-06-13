import { describe, expect, it } from 'vitest';
import { calcularIvaDocumento, type LineaIvaInput } from '../src/iva/calcular-iva';
import golden from './iva-multialicuota.golden.json';

/**
 * Golden tests del motor de IVA multi-alícuota (casos 12, 14 y 22 del doc 07). Los valores
 * esperados viven en iva-multialicuota.golden.json, verificados a mano; este runner solo afirma
 * que el motor los reproduce EXACTAMENTE.
 */
describe('IVA multi-alícuota — golden (doc 07 §B)', () => {
  it('caso 12: líneas 16%, 8% y exentas, discriminadas y cuadradas', () => {
    const c = golden.caso12_lineas_16_8_exentas;
    expect(calcularIvaDocumento(c.lineas as LineaIvaInput[])).toEqual(c.esperado);
  });

  it('caso 22: exportación 0% en su propia columna', () => {
    const c = golden.caso22_exportacion;
    expect(calcularIvaDocumento(c.lineas as LineaIvaInput[])).toEqual(c.esperado);
  });

  it('caso 12b: dos líneas de la misma alícuota suman; descuento de línea; adicional 31%', () => {
    const c = golden.caso12b_dos_lineas_misma_alicuota_con_descuento;
    expect(calcularIvaDocumento(c.lineas as LineaIvaInput[])).toEqual(c.esperado);
  });

  it('caso 14: cambio de alícuota a mitad de mes — cada documento usa su tasa', () => {
    for (const doc of golden.caso14_cambio_alicuota_a_mitad_de_mes.documentos) {
      expect(calcularIvaDocumento(doc.lineas as LineaIvaInput[])).toEqual(doc.esperado);
    }
  });
});
