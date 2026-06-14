import { describe, expect, it } from 'vitest';
import { type MovBanco, type MovSistema, sugerirConciliaciones } from './matching';

describe('sugerirConciliaciones — 1:1', () => {
  const banco: MovBanco[] = [
    { id: 'b1', fecha: '2026-05-10', monto: '1500.00', referencia: '000456789' },
    { id: 'b2', fecha: '2026-05-12', monto: '-850.75', referencia: '000456812' },
  ];
  const sistema: MovSistema[] = [
    { id: 's1', fecha: '2026-05-10', monto: '1500.00', referencia: 'PM 456789' },
    { id: 's2', fecha: '2026-05-13', monto: '-850.75', referencia: '456812' },
  ];

  it('empareja por monto+fecha+referencia con score alto', () => {
    const sug = sugerirConciliaciones(banco, sistema);
    const m1 = sug.find((s) => s.bancoIds[0] === 'b1');
    expect(m1?.tipo).toBe('UNO_A_UNO');
    expect(m1?.sistemaIds).toEqual(['s1']);
    expect(m1?.score).toBeGreaterThan(90);
    expect(sug.find((s) => s.bancoIds[0] === 'b2')?.sistemaIds).toEqual(['s2']);
  });

  it('no empareja montos de signo distinto', () => {
    const sug = sugerirConciliaciones(
      [{ id: 'b1', fecha: '2026-05-10', monto: '1500.00', referencia: null }],
      [{ id: 's1', fecha: '2026-05-10', monto: '-1500.00', referencia: null }],
    );
    expect(sug).toHaveLength(0);
  });

  it('respeta la tolerancia de monto (céntimos de tasa)', () => {
    const dentro = sugerirConciliaciones(
      [{ id: 'b1', fecha: '2026-05-10', monto: '1500.00', referencia: '99' }],
      [{ id: 's1', fecha: '2026-05-10', monto: '1500.02', referencia: '99' }],
      { toleranciaMonto: '0.02' },
    );
    expect(dentro).toHaveLength(1);
    const fuera = sugerirConciliaciones(
      [{ id: 'b1', fecha: '2026-05-10', monto: '1500.00', referencia: '99' }],
      [{ id: 's1', fecha: '2026-05-10', monto: '1501.00', referencia: '99' }],
      { toleranciaMonto: '0.02' },
    );
    expect(fuera).toHaveLength(0);
  });
});

describe('sugerirConciliaciones — 1:n y n:1', () => {
  it('1:n: un abono de banco = suma de dos cobros del sistema', () => {
    const banco: MovBanco[] = [{ id: 'b1', fecha: '2026-05-10', monto: '300.00', referencia: null }];
    const sistema: MovSistema[] = [
      { id: 's1', fecha: '2026-05-10', monto: '100.00', referencia: null },
      { id: 's2', fecha: '2026-05-11', monto: '200.00', referencia: null },
    ];
    const sug = sugerirConciliaciones(banco, sistema);
    const m = sug.find((s) => s.tipo === 'UNO_A_N');
    expect(m?.bancoIds).toEqual(['b1']);
    expect(new Set(m?.sistemaIds)).toEqual(new Set(['s1', 's2']));
  });

  it('n:1: un cargo del sistema = suma de dos cargos del banco', () => {
    const banco: MovBanco[] = [
      { id: 'b1', fecha: '2026-05-10', monto: '-40.00', referencia: null },
      { id: 'b2', fecha: '2026-05-10', monto: '-60.00', referencia: null },
    ];
    const sistema: MovSistema[] = [{ id: 's1', fecha: '2026-05-10', monto: '-100.00', referencia: null }];
    const sug = sugerirConciliaciones(banco, sistema);
    const m = sug.find((s) => s.tipo === 'N_A_UNO');
    expect(m?.sistemaIds).toEqual(['s1']);
    expect(new Set(m?.bancoIds)).toEqual(new Set(['b1', 'b2']));
  });

  it('prefiere 1:1 sobre el agrupamiento cuando hay un par exacto', () => {
    const banco: MovBanco[] = [{ id: 'b1', fecha: '2026-05-10', monto: '100.00', referencia: '7' }];
    const sistema: MovSistema[] = [
      { id: 's1', fecha: '2026-05-10', monto: '100.00', referencia: '7' },
      { id: 's2', fecha: '2026-05-10', monto: '60.00', referencia: null },
      { id: 's3', fecha: '2026-05-10', monto: '40.00', referencia: null },
    ];
    const sug = sugerirConciliaciones(banco, sistema);
    expect(sug.find((s) => s.bancoIds[0] === 'b1')?.tipo).toBe('UNO_A_UNO');
  });
});
