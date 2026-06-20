import { describe, expect, it } from 'vitest';
import { cumplePoliticaDosFactores, requiereDosFactores } from './dos-factores';

describe('Política de segundo factor (docs/05 §6)', () => {
  it('exige 2FA a owner, admin y contador', () => {
    expect(requiereDosFactores('owner')).toBe(true);
    expect(requiereDosFactores('admin')).toBe(true);
    expect(requiereDosFactores('contador')).toBe(true);
  });

  it('no exige 2FA a cajero, vendedor ni auditor', () => {
    expect(requiereDosFactores('cajero')).toBe(false);
    expect(requiereDosFactores('vendedor')).toBe(false);
    expect(requiereDosFactores('auditor')).toBe(false);
  });

  it('roles obligados deben tener TOTP habilitado y confirmado', () => {
    const sinTotp = { totpHabilitado: false, totpConfirmadoEn: null };
    const habilitadoSinConfirmar = { totpHabilitado: true, totpConfirmadoEn: null };
    const ok = { totpHabilitado: true, totpConfirmadoEn: new Date('2026-06-01T00:00:00Z') };

    expect(cumplePoliticaDosFactores('contador', sinTotp)).toBe(false);
    expect(cumplePoliticaDosFactores('contador', habilitadoSinConfirmar)).toBe(false);
    expect(cumplePoliticaDosFactores('contador', ok)).toBe(true);
  });

  it('roles no obligados cumplen aunque no tengan 2FA', () => {
    const sinTotp = { totpHabilitado: false, totpConfirmadoEn: null };
    expect(cumplePoliticaDosFactores('cajero', sinTotp)).toBe(true);
    expect(cumplePoliticaDosFactores('vendedor', sinTotp)).toBe(true);
  });
});
