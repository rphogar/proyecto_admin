import { describe, expect, it } from 'vitest';
import { rateFor, type TasaCambio, tasaDeCierre } from './rate-for';

// Tasas BCV de ejemplo (valores ilustrativos con 8 decimales, regla 1/2).
const tasa = (
  rateDate: string,
  rate: string,
  capturedAt = `${rateDate}T13:30:00.000Z`,
  source: TasaCambio['source'] = 'BCV',
): TasaCambio => ({ moneda: 'USD', rate, rateDate, source, capturedAt });

describe('rateFor — última tasa publicada anterior (docs/05 §3.3)', () => {
  const tasas: readonly TasaCambio[] = [
    tasa('2026-06-04', '36.50000000'),
    tasa('2026-06-05', '36.80000000'), // viernes
    // 2026-06-06 sábado y 2026-06-07 domingo: sin publicación.
    tasa('2026-06-08', '37.10000000'), // lunes
  ];

  it('caso 1 [GOLDEN]: sábado/domingo sin tasa → usa la última publicada (viernes)', () => {
    expect(rateFor(tasas, '2026-06-06', 'USD')?.rate).toBe('36.80000000'); // sábado
    expect(rateFor(tasas, '2026-06-06', 'USD')?.rateDate).toBe('2026-06-05');
    expect(rateFor(tasas, '2026-06-07', 'USD')?.rate).toBe('36.80000000'); // domingo
  });

  it('devuelve la tasa exacta cuando el día sí tiene publicación', () => {
    expect(rateFor(tasas, '2026-06-08', 'USD')?.rate).toBe('37.10000000');
  });

  it('caso 2: 8:00am antes de publicar la del día → rige la del día anterior', () => {
    // Aún no existe fila para 2026-06-09; lo último publicado es el lunes 08.
    expect(rateFor(tasas, '2026-06-09', 'USD')?.rateDate).toBe('2026-06-08');
  });

  it('devuelve null si no hay ninguna tasa aplicable (fecha anterior a todo el histórico)', () => {
    expect(rateFor(tasas, '2026-06-01', 'USD')).toBeNull();
  });

  it('filtra por moneda (no mezcla USD con EUR)', () => {
    const conEur: readonly TasaCambio[] = [
      ...tasas,
      { moneda: 'EUR', rate: '40.00000000', rateDate: '2026-06-05', source: 'BCV', capturedAt: '2026-06-05T13:30:00.000Z' },
    ];
    expect(rateFor(conEur, '2026-06-08', 'EUR')?.rate).toBe('40.00000000');
    expect(rateFor(conEur, '2026-06-08', 'USD')?.rate).toBe('37.10000000');
  });

  it('normaliza la moneda a mayúsculas', () => {
    expect(rateFor(tasas, '2026-06-08', 'usd')?.rate).toBe('37.10000000');
  });

  it('caso 3: corrección del mismo día → gana la de capturedAt más reciente para docs nuevos', () => {
    const conCorreccion: readonly TasaCambio[] = [
      tasa('2026-06-08', '37.10000000', '2026-06-08T13:30:00.000Z'), // original
      tasa('2026-06-08', '37.25000000', '2026-06-08T17:45:00.000Z'), // corrección posterior
    ];
    expect(rateFor(conCorreccion, '2026-06-08', 'USD')?.rate).toBe('37.25000000');
    // La fila original sigue presente e inmutable en la colección (no se muta).
    expect(conCorreccion.some((t) => t.rate === '37.10000000')).toBe(true);
  });
});

describe('tasaDeCierre — última tasa del mes (insumo de reexpresión, caso 11)', () => {
  it('toma la última publicada ≤ último día civil del mes (Caracas)', () => {
    const tasas: readonly TasaCambio[] = [
      tasa('2026-05-29', '36.00000000'), // viernes; cierre de mayo cae en fin de semana (30-31)
      tasa('2026-06-02', '37.00000000'), // ya es junio, no aplica al cierre de mayo
    ];
    expect(tasaDeCierre(tasas, 2026, 5, 'USD')?.rate).toBe('36.00000000');
    expect(tasaDeCierre(tasas, 2026, 5, 'USD')?.rateDate).toBe('2026-05-29');
  });
});
