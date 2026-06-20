import { describe, expect, it } from 'vitest';
import {
  type LineaAsiento,
  verificarBalanceAsientos,
  verificarCuadreGlobal,
  verificarInvariantes,
  verificarNumeracion,
} from './verificacion-invariantes';

function linea(entryId: string, dc: 'D' | 'C', ves: string, usd: string, origen: string): LineaAsiento {
  return { entryId, dc, currency: 'VES', amountVes: ves, amountUsdMgmt: usd, amountOrigen: origen };
}

describe('verificarBalanceAsientos (§7.1)', () => {
  it('acepta un asiento que cuadra en las tres bases', () => {
    const lineas = [
      linea('e1', 'D', '116.00', '2.90', '116.00'),
      linea('e1', 'C', '100.00', '2.50', '100.00'),
      linea('e1', 'C', '16.00', '0.40', '16.00'),
    ];
    const { violaciones, asientos } = verificarBalanceAsientos(lineas);
    expect(violaciones).toHaveLength(0);
    expect(asientos).toBe(1);
  });

  it('detecta descuadre en una base (USD)', () => {
    const lineas = [
      linea('e1', 'D', '116.00', '2.90', '116.00'),
      linea('e1', 'C', '116.00', '2.80', '116.00'), // USD no cuadra
    ];
    const { violaciones } = verificarBalanceAsientos(lineas);
    expect(violaciones).toHaveLength(1);
    expect(violaciones[0]?.detalle).toContain('USD');
  });

  it('usa precisión Decimal (sin error de float en 8 decimales)', () => {
    const lineas = [
      linea('e1', 'D', '0.00000003', '0', '0.00000003'),
      linea('e1', 'C', '0.00000001', '0', '0.00000001'),
      linea('e1', 'C', '0.00000002', '0', '0.00000002'),
    ];
    expect(verificarBalanceAsientos(lineas).violaciones).toHaveLength(0);
  });
});

describe('verificarNumeracion (§7.2)', () => {
  it('acepta correlativo 1..N contiguo', () => {
    const docs = [1, 2, 3, 4].map((number) => ({ seriesId: 's1', number }));
    const { violaciones, series } = verificarNumeracion(docs);
    expect(violaciones).toHaveLength(0);
    expect(series).toBe(1);
  });

  it('detecta un hueco', () => {
    const docs = [1, 2, 4].map((number) => ({ seriesId: 's1', number }));
    const { violaciones } = verificarNumeracion(docs);
    expect(violaciones.some((v) => v.invariante.includes('sin huecos'))).toBe(true);
  });

  it('detecta duplicados', () => {
    const docs = [1, 2, 2, 3].map((number) => ({ seriesId: 's1', number }));
    const { violaciones } = verificarNumeracion(docs);
    expect(violaciones.some((v) => v.invariante.includes('sin duplicados'))).toBe(true);
  });

  it('verifica cada serie por separado', () => {
    const docs = [
      { seriesId: 's1', number: 1 },
      { seriesId: 's1', number: 2 },
      { seriesId: 's2', number: 1 },
    ];
    expect(verificarNumeracion(docs).violaciones).toHaveLength(0);
  });
});

describe('verificarCuadreGlobal (§7.8)', () => {
  it('cuadra cuando todos los asientos cuadran', () => {
    const lineas = [
      linea('e1', 'D', '100', '2.5', '100'),
      linea('e1', 'C', '100', '2.5', '100'),
      linea('e2', 'D', '50', '1.25', '50'),
      linea('e2', 'C', '50', '1.25', '50'),
    ];
    expect(verificarCuadreGlobal(lineas)).toHaveLength(0);
  });

  it('detecta descuadre global en VES', () => {
    const lineas = [linea('e1', 'D', '100', '2.5', '100'), linea('e1', 'C', '99', '2.5', '99')];
    const violaciones = verificarCuadreGlobal(lineas);
    expect(violaciones.some((v) => v.detalle.includes('VES'))).toBe(true);
  });
});

describe('verificarInvariantes — reporte agregado', () => {
  it('ok=true cuando todo cuadra', () => {
    const reporte = verificarInvariantes({
      lineasAsientos: [linea('e1', 'D', '100', '2.5', '100'), linea('e1', 'C', '100', '2.5', '100')],
      documentos: [
        { seriesId: 's1', number: 1 },
        { seriesId: 's1', number: 2 },
      ],
    });
    expect(reporte.ok).toBe(true);
    expect(reporte.violaciones).toHaveLength(0);
    expect(reporte.asientosVerificados).toBe(1);
    expect(reporte.seriesVerificadas).toBe(1);
  });

  it('ok=false y agrega violaciones de balance, numeración y cuadre', () => {
    const reporte = verificarInvariantes({
      lineasAsientos: [linea('e1', 'D', '100', '2.5', '100'), linea('e1', 'C', '99', '2.5', '99')],
      documentos: [
        { seriesId: 's1', number: 1 },
        { seriesId: 's1', number: 3 },
      ],
    });
    expect(reporte.ok).toBe(false);
    expect(reporte.violaciones.length).toBeGreaterThanOrEqual(2);
  });
});
