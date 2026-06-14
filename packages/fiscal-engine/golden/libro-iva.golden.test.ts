import { describe, expect, it } from 'vitest';
import { calcularPlanillaIva } from '../src/declaraciones/planilla-iva';
import { type FilaImpuestoLibro, resumirLibro } from '../src/libros/resumen-libro';
import golden from './libro-iva.golden.json';

/**
 * Golden P10 — Libros y planilla de IVA sobre un mes sintético (docs/02 §7.2, §3.2; docs/05 §7.3).
 * Valores verificados a mano en el JSON. Demuestra el **kernel de la triple igualdad**: el resumen
 * del Libro de Ventas/Compras y la planilla de IVA se derivan de las MISMAS filas de impuestos, de
 * modo que el débito de la planilla == IVA del Libro de Ventas y el crédito == IVA del Libro de
 * Compras. La igualdad con los documentos persistidos se prueba en el test de integración del API.
 */
describe('Libros + planilla IVA — golden (mes sintético, triple igualdad)', () => {
  const m = golden.mes_sintetico;

  it('Libro de Ventas: neto por alícuota con NC restada (caso 8/17)', () => {
    expect(resumirLibro(m.ventas as FilaImpuestoLibro[])).toEqual(m.libroVentasEsperado);
  });

  it('Libro de Compras: crédito fiscal por alícuota', () => {
    expect(resumirLibro(m.compras as FilaImpuestoLibro[])).toEqual(m.libroComprasEsperado);
  });

  it('Planilla IVA: débito − crédito − retenciones, derivada de los libros', () => {
    const ventas = resumirLibro(m.ventas as FilaImpuestoLibro[]);
    const compras = resumirLibro(m.compras as FilaImpuestoLibro[]);
    const planilla = calcularPlanillaIva({
      debito: ventas.grupos,
      credito: compras.grupos,
      retencionesDelPeriodo: m.retencionesSoportadasIva,
    });
    expect(planilla).toEqual(m.planillaEsperada);
  });

  it('triple igualdad: débito de la planilla == IVA del Libro de Ventas', () => {
    const ventas = resumirLibro(m.ventas as FilaImpuestoLibro[]);
    const compras = resumirLibro(m.compras as FilaImpuestoLibro[]);
    const planilla = calcularPlanillaIva({ debito: ventas.grupos, credito: compras.grupos });
    expect(planilla.debitoFiscal).toBe(ventas.ivaTotal);
    expect(planilla.creditoFiscalDelPeriodo).toBe(compras.ivaTotal);
  });
});
