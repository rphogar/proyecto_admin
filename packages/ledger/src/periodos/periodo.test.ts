import { describe, expect, it } from 'vitest';
import {
  LibroDePeriodos,
  PeriodoCerradoError,
  periodoDeFecha,
  referenciaAPeriodoAfectado,
} from './periodo';

// 2026-01-31 22:00 Caracas = 2026-02-01 02:00Z → período fiscal de ENERO (corte en Caracas).
const FIN_ENERO_CARACAS = '2026-02-01T02:00:00.000Z';

describe('LibroDePeriodos (docs/05 §3.5, regla 9, caso 42)', () => {
  it('deriva el período en hora de Caracas (no UTC)', () => {
    expect(periodoDeFecha(FIN_ENERO_CARACAS)).toEqual({ anio: 2026, mes: 1 });
  });

  it('los períodos no registrados están abiertos por defecto', () => {
    const libro = LibroDePeriodos.desde();
    expect(libro.estaAbierto(2026, 3)).toBe(true);
    expect(() => libro.validarFecha('2026-03-15T12:00:00Z')).not.toThrow();
  });

  it('un período cerrado rechaza asientos con fecha dentro del período (caso 42)', () => {
    const libro = LibroDePeriodos.desde([{ anio: 2026, mes: 1, estado: 'CLOSED' }]);
    expect(libro.estaAbierto(2026, 1)).toBe(false);
    expect(() => libro.validarFecha(FIN_ENERO_CARACAS)).toThrow(PeriodoCerradoError);
    try {
      libro.validarFecha(FIN_ENERO_CARACAS);
    } catch (e) {
      expect((e as PeriodoCerradoError).periodo).toEqual({ anio: 2026, mes: 1 });
    }
  });

  it('cerrar y reabrir devuelven libros nuevos (inmutable)', () => {
    const abierto = LibroDePeriodos.desde();
    const cerrado = abierto.cerrar(2026, 1);
    expect(abierto.estaAbierto(2026, 1)).toBe(true); // original intacto
    expect(cerrado.estaAbierto(2026, 1)).toBe(false);
    expect(cerrado.reabrir(2026, 1).estaAbierto(2026, 1)).toBe(true);
  });

  it('rechaza meses inválidos', () => {
    expect(() => LibroDePeriodos.desde([{ anio: 2026, mes: 13, estado: 'OPEN' }])).toThrow(
      /Mes de período inválido/,
    );
  });

  it('produce una referencia textual al período afectado', () => {
    expect(referenciaAPeriodoAfectado(2026, 1)).toContain('2026-01');
  });
});
