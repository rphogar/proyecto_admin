import { Asiento, planDeCuentasBase } from '@contave/ledger';
import { describe, expect, it } from 'vitest';
import { aplicarPlantilla, type ContextoAplicacion, type PlantillaResuelta } from './aplicar-plantilla';

/**
 * Motor puro de plantillas (P13). Una plantilla bien definida produce SIEMPRE un asiento que cuadra
 * en triple base, sea cual sea el set de magnitudes (mientras NETO = BASE + IVA en cada base). Es la
 * propiedad clave: la UI nunca arma asientos a mano, los deriva de la plantilla.
 */

// Plantilla de factura de venta: D Clientes (NETO) / C Ventas (BASE) / C IVA débito (IVA).
const FACTURA_VENTA: PlantillaResuelta = {
  descripcionAsiento: 'Factura de venta',
  lineas: [
    { lineaNo: 1, cuentaCodigo: '1.2.01', dc: 'D', magnitud: 'NETO', signo: 'POSITIVO', esAjuste: false, usaParty: true },
    { lineaNo: 2, cuentaCodigo: '4.1', dc: 'C', magnitud: 'BASE', signo: 'POSITIVO', esAjuste: false, usaParty: false },
    { lineaNo: 3, cuentaCodigo: '2.3.01', dc: 'C', magnitud: 'IVA', signo: 'POSITIVO', esAjuste: false, usaParty: false },
  ],
};

function ctxFactura(base: { ves: string; usd: string }, iva: { ves: string; usd: string }): ContextoAplicacion {
  const neto = { ves: sumar(base.ves, iva.ves), usd: sumar(base.usd, iva.usd) };
  return {
    fecha: '2026-03-10T14:00:00.000Z',
    moneda: 'VES',
    rateBcv: '36',
    rateUsdMgmt: '36',
    sourceType: 'FACTURA',
    sourceId: 'doc-1',
    partyId: 'cliente-1',
    magnitudes: {
      BASE: { origen: base.ves, ves: base.ves, usd: base.usd },
      IVA: { origen: iva.ves, ves: iva.ves, usd: iva.usd },
      NETO: { origen: neto.ves, ves: neto.ves, usd: neto.usd },
    },
  };
}

function sumar(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2);
}

describe('aplicarPlantilla (P13, docs/03 §5)', () => {
  it('produce un asiento que cuadra en triple base para distintos montos', () => {
    const casos: Array<[{ ves: string; usd: string }, { ves: string; usd: string }]> = [
      [{ ves: '1000', usd: '34.48' }, { ves: '160', usd: '5.52' }],
      [{ ves: '2500.50', usd: '70.00' }, { ves: '400.08', usd: '11.20' }],
      [{ ves: '1', usd: '0.03' }, { ves: '0.16', usd: '0.01' }],
    ];
    for (const [base, iva] of casos) {
      const entrada = aplicarPlantilla(FACTURA_VENTA, ctxFactura(base, iva));
      const asiento = Asiento.construir(entrada, { plan: planDeCuentasBase() });
      expect(asiento.totalDebeVes().igualA(asiento.totalHaberVes())).toBe(true);
      expect(asiento.lineas).toHaveLength(3);
      // El party solo se estampa en la línea marcada `usaParty`.
      expect(asiento.lineas[0]!.partyId).toBe('cliente-1');
      expect(asiento.lineas[1]!.partyId).toBeUndefined();
    }
  });

  it('hereda el sourceType/sourceId y la descripción de la plantilla', () => {
    const entrada = aplicarPlantilla(FACTURA_VENTA, ctxFactura({ ves: '1000', usd: '34.48' }, { ves: '160', usd: '5.52' }));
    expect(entrada.sourceType).toBe('FACTURA');
    expect(entrada.sourceId).toBe('doc-1');
    expect(entrada.descripcion).toBe('Factura de venta');
  });

  it('signo NEGATIVO invierte el lado de la línea (p.ej. neteo de retención)', () => {
    const plantilla: PlantillaResuelta = {
      descripcionAsiento: 'Neteo',
      lineas: [
        { lineaNo: 1, cuentaCodigo: '1.1.01', dc: 'D', magnitud: 'MONTO', signo: 'POSITIVO', esAjuste: false, usaParty: false },
        { lineaNo: 2, cuentaCodigo: '4.6', dc: 'D', magnitud: 'MONTO', signo: 'NEGATIVO', esAjuste: false, usaParty: false },
      ],
    };
    const entrada = aplicarPlantilla(plantilla, {
      fecha: '2026-03-10T14:00:00.000Z',
      moneda: 'VES',
      sourceType: 'MANUAL',
      magnitudes: { MONTO: { origen: '500', ves: '500', usd: '13.89' } },
    });
    // La línea 2 (signo NEGATIVO sobre dc='D') queda al haber.
    expect(entrada.lineas[1]!.dc).toBe('C');
    expect(entrada.lineas[1]!.montoVes).toBe('500');
  });

  it('omite líneas con magnitud en cero', () => {
    const entrada = aplicarPlantilla(FACTURA_VENTA, ctxFactura({ ves: '1000', usd: '34.48' }, { ves: '0', usd: '0' }));
    // IVA = 0 → su línea se omite; quedan Clientes y Ventas.
    expect(entrada.lineas).toHaveLength(2);
    expect(entrada.lineas.map((l) => l.cuenta)).toEqual(['1.2.01', '4.1']);
  });

  it('lanza si falta una magnitud requerida', () => {
    const ctx: ContextoAplicacion = {
      fecha: '2026-03-10T14:00:00.000Z',
      moneda: 'VES',
      sourceType: 'FACTURA',
      magnitudes: {
        NETO: { origen: '1160', ves: '1160', usd: '40' },
        BASE: { origen: '1000', ves: '1000', usd: '34.48' },
      },
    };
    expect(() => aplicarPlantilla(FACTURA_VENTA, ctx)).toThrow(/magnitud "IVA"/);
  });
});
