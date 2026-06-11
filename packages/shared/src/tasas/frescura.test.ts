import { describe, expect, it } from 'vitest';
import { diasDeRezago, estadoFrescura } from './frescura';
import type { TasaCambio } from './rate-for';

const tasaDel = (rateDate: string): TasaCambio => ({
  moneda: 'USD',
  rate: '37.00000000',
  rateDate,
  source: 'BCV',
  capturedAt: `${rateDate}T13:30:00.000Z`,
});

describe('estadoFrescura — banner de tasa rezagada (caso 57)', () => {
  it('fresca cuando la tasa es de hoy o de un fin de semana reciente (≤ maxDias)', () => {
    expect(estadoFrescura(tasaDel('2026-06-11'), '2026-06-11')).toBe('fresca'); // mismo día
    expect(estadoFrescura(tasaDel('2026-06-08'), '2026-06-11')).toBe('fresca'); // 3 días (fin de semana largo)
  });

  it('rezagada entre maxDias y 2*maxDias sin tasa nueva', () => {
    expect(estadoFrescura(tasaDel('2026-06-06'), '2026-06-11')).toBe('rezagada'); // 5 días
  });

  it('caso 57: el job falla varios días → crítica (> 2*maxDias)', () => {
    expect(estadoFrescura(tasaDel('2026-06-03'), '2026-06-11')).toBe('critica'); // 8 días
  });

  it('crítica si no hay ninguna tasa', () => {
    expect(estadoFrescura(null, '2026-06-11')).toBe('critica');
  });

  it('respeta un umbral configurable', () => {
    // Con maxDias=1, una tasa de hace 2 días ya es rezagada (con el default 3 sería fresca).
    expect(estadoFrescura(tasaDel('2026-06-09'), '2026-06-11', 1)).toBe('rezagada');
    expect(estadoFrescura(tasaDel('2026-06-09'), '2026-06-11')).toBe('fresca');
  });

  it('diasDeRezago calcula el rezago civil y null sin tasa', () => {
    expect(diasDeRezago(tasaDel('2026-06-08'), '2026-06-11')).toBe(3);
    expect(diasDeRezago(null, '2026-06-11')).toBeNull();
  });
});
