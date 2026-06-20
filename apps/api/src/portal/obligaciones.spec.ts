import { describe, expect, it } from 'vitest';
import {
  type CalendarioSpe,
  claveDeclaracion,
  diferenciaDias,
  obligacionesDeEmpresa,
  periodoAnterior,
  periodoSiguiente,
  type PerfilEmpresa,
  terminalRif,
} from './obligaciones';

const ordinario: PerfilEmpresa = {
  companyId: 'c1',
  rif: 'J-00000001-5',
  razonSocial: 'Ordinaria C.A.',
  tipoContribuyente: 'ORDINARIO',
  spe: false,
};
const especial: PerfilEmpresa = { ...ordinario, companyId: 'c2', rif: 'J-00000002-3', razonSocial: 'Especial C.A.', tipoContribuyente: 'ESPECIAL', spe: true };

describe('obligacionesDeEmpresa (P16, docs/02 §10)', () => {
  it('el ordinario solo tiene IVA mensual; vence el día 15 del mes siguiente', () => {
    const obs = obligacionesDeEmpresa(ordinario, '2026-06-15', [{ anio: 2026, mes: 5 }], new Set());
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ tipo: 'IVA', periodo: '2026-05', fechaLimite: '2026-06-15', estado: 'PENDIENTE' });
    // hoy = el propio día 15 → 0 días restantes.
    expect(obs[0]!.diasRestantes).toBe(0);
  });

  it('el SPE suma IGTF percibido al IVA del período', () => {
    const obs = obligacionesDeEmpresa(especial, '2026-06-10', [{ anio: 2026, mes: 5 }], new Set());
    expect(obs.map((o) => o.tipo).sort()).toEqual(['IGTF', 'IVA']);
    expect(obs.every((o) => o.fechaLimite === '2026-06-15')).toBe(true);
    expect(obs.every((o) => o.diasRestantes === 5)).toBe(true);
  });

  it('marca PRESENTADA si hay una declaración presentada para (tipo, período)', () => {
    const presentadas = new Set([claveDeclaracion('IVA', 2026, 5)]);
    const obs = obligacionesDeEmpresa(especial, '2026-06-10', [{ anio: 2026, mes: 5 }], presentadas);
    expect(obs.find((o) => o.tipo === 'IVA')!.estado).toBe('PRESENTADA');
    expect(obs.find((o) => o.tipo === 'IGTF')!.estado).toBe('PENDIENTE');
  });

  it('días restantes negativos cuando la fecha límite ya pasó', () => {
    const obs = obligacionesDeEmpresa(ordinario, '2026-06-20', [{ anio: 2026, mes: 5 }], new Set());
    expect(obs[0]!.diasRestantes).toBe(-5);
  });

  it('SPE: la fecha límite viene del calendario por terminal de RIF (datos por providencia)', () => {
    // RIF J-00000002-3 → terminal '3'. Calendario fija el IVA de 2026-05 al día 22.
    const calendario: CalendarioSpe = [
      { terminalRif: '3', tipo: 'IVA', periodoAnio: 2026, periodoMes: 5, fechaLimite: '2026-06-22' },
    ];
    const obs = obligacionesDeEmpresa(especial, '2026-06-10', [{ anio: 2026, mes: 5 }], new Set(), calendario);
    expect(obs.find((o) => o.tipo === 'IVA')!.fechaLimite).toBe('2026-06-22');
    // IGTF no está en el calendario → cae a la regla ordinaria (día 15).
    expect(obs.find((o) => o.tipo === 'IGTF')!.fechaLimite).toBe('2026-06-15');
  });

  it('el ordinario ignora el calendario SPE (su vencimiento es legal, día 15)', () => {
    const calendario: CalendarioSpe = [
      { terminalRif: '5', tipo: 'IVA', periodoAnio: 2026, periodoMes: 5, fechaLimite: '2026-06-22' },
    ];
    const obs = obligacionesDeEmpresa(ordinario, '2026-06-10', [{ anio: 2026, mes: 5 }], new Set(), calendario);
    expect(obs[0]!.fechaLimite).toBe('2026-06-15');
  });

  it('terminalRif extrae el último dígito del RIF', () => {
    expect(terminalRif('J-13579246-8')).toBe('8');
    expect(terminalRif('V-00000002-3')).toBe('3');
    expect(terminalRif('sin-digitos')).toBeNull();
  });

  it('genera obligaciones para varios períodos', () => {
    const obs = obligacionesDeEmpresa(ordinario, '2026-06-15', [
      { anio: 2026, mes: 4 },
      { anio: 2026, mes: 5 },
    ], new Set());
    expect(obs.map((o) => o.periodo)).toEqual(['2026-04', '2026-05']);
    expect(obs[0]!.fechaLimite).toBe('2026-05-15');
  });
});

describe('aritmética de períodos y fechas', () => {
  it('periodoSiguiente envuelve diciembre→enero', () => {
    expect(periodoSiguiente(2026, 12)).toEqual({ anio: 2027, mes: 1 });
    expect(periodoSiguiente(2026, 6)).toEqual({ anio: 2026, mes: 7 });
  });

  it('periodoAnterior envuelve enero→diciembre', () => {
    expect(periodoAnterior(2026, 1)).toEqual({ anio: 2025, mes: 12 });
    expect(periodoAnterior(2026, 6)).toEqual({ anio: 2026, mes: 5 });
  });

  it('diferenciaDias cuenta días civiles con signo', () => {
    expect(diferenciaDias('2026-06-15', '2026-06-10')).toBe(5);
    expect(diferenciaDias('2026-06-10', '2026-06-15')).toBe(-5);
    expect(diferenciaDias('2026-07-01', '2026-06-01')).toBe(30);
  });
});
