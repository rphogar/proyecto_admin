import { describe, expect, it } from 'vitest';
import { inferirPerfilTributario } from './inferir-perfil';

describe('inferirPerfilTributario (docs/02 §1)', () => {
  it('SPE: agente de retención IVA+ISLR, percibe IGTF, excluido del ajuste, calendario especial', () => {
    const p = inferirPerfilTributario({ tipoContribuyente: 'ESPECIAL', formaJuridica: 'PJ' });
    expect(p.esSpe).toBe(true);
    expect(p.cobraIva).toBe(true);
    expect(p.periodicidadIva).toBe('CALENDARIO_SPE');
    expect(p.esAgenteRetencionIva).toBe(true);
    expect(p.esAgenteRetencionIslr).toBe(true);
    expect(p.percibeIgtf).toBe(true);
    expect(p.excluidoAjusteInflacion).toBe(true);
    expect(p.seriesRetencion).toEqual([
      'COMPROBANTE_RETENCION_IVA',
      'COMPROBANTE_RETENCION_ISLR',
    ]);
  });

  it('ordinario PJ: cobra IVA mensual, no retiene ni percibe, ISLR 34%', () => {
    const p = inferirPerfilTributario({ tipoContribuyente: 'ORDINARIO', formaJuridica: 'PJ' });
    expect(p.esSpe).toBe(false);
    expect(p.cobraIva).toBe(true);
    expect(p.periodicidadIva).toBe('MENSUAL');
    expect(p.esAgenteRetencionIva).toBe(false);
    expect(p.percibeIgtf).toBe(false);
    expect(p.excluidoAjusteInflacion).toBe(false);
    expect(p.alicuotaIslrPj).toBe(34);
    expect(p.seriesRetencion).toEqual([]);
  });

  it('formal: no cobra IVA (solo operaciones exentas)', () => {
    const p = inferirPerfilTributario({ tipoContribuyente: 'FORMAL', formaJuridica: 'PN' });
    expect(p.cobraIva).toBe(false);
    expect(p.periodicidadIva).toBe('MENSUAL');
    expect(p.alicuotaIslrPj).toBeNull(); // PN no usa Tarifa N° 2
  });

  it('ordinario designado agente de ISLR sin ser SPE: precarga serie de retención ISLR', () => {
    const p = inferirPerfilTributario({
      tipoContribuyente: 'ORDINARIO',
      formaJuridica: 'PJ',
      esAgenteRetencionIslr: true,
    });
    expect(p.esAgenteRetencionIva).toBe(false);
    expect(p.esAgenteRetencionIslr).toBe(true);
    expect(p.seriesRetencion).toEqual(['COMPROBANTE_RETENCION_ISLR']);
  });

  it('normaliza ejercicio fiscal fuera de rango a enero y días de utilidades al mínimo legal', () => {
    const p = inferirPerfilTributario({
      tipoContribuyente: 'ORDINARIO',
      formaJuridica: 'PJ',
      ejercicioFiscalInicio: 13,
      diasUtilidades: 5,
    });
    expect(p.ejercicioFiscalInicio).toBe(1);
    expect(p.diasUtilidades).toBe(15);
  });

  it('conserva ejercicio fiscal y días de utilidades válidos, y el % de retención que le aplican', () => {
    const p = inferirPerfilTributario({
      tipoContribuyente: 'ORDINARIO',
      formaJuridica: 'PJ',
      ejercicioFiscalInicio: 7,
      diasUtilidades: 60,
      pctRetencionQueLeAplican: 75,
      riesgoIvss: 'medio',
    });
    expect(p.ejercicioFiscalInicio).toBe(7);
    expect(p.diasUtilidades).toBe(60);
    expect(p.pctRetencionQueLeAplican).toBe(75);
    expect(p.riesgoIvss).toBe('medio');
  });
});
