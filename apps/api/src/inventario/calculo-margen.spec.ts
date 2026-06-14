import { describe, expect, it } from 'vitest';
import { detectarMargenNegativo, type ItemMargen } from './calculo-margen';

/** Tests del cálculo puro de la alerta de margen negativo en USD (doc 06 M5). */
describe('detectarMargenNegativo', () => {
  const items: ItemMargen[] = [
    { itemId: 'a', sku: 'A', descripcion: 'Sano', precioUsd: '12', costoUsd: '10' },
    { itemId: 'b', sku: 'B', descripcion: 'Vende bajo costo', precioUsd: '9', costoUsd: '10' },
    { itemId: 'c', sku: 'C', descripcion: 'Sin costo', precioUsd: '5', costoUsd: '0' },
  ];

  it('marca solo los ítems que venden por debajo del costo USD', () => {
    const r = detectarMargenNegativo(items);
    expect(r.alertas).toHaveLength(1);
    expect(r.alertas[0]!.itemId).toBe('b');
    expect(r.alertas[0]!.margenUsd).toBe('-1.0000');
    expect(r.alertas[0]!.negativo).toBe(true);
  });

  it('un ítem sin costo (nunca comprado) no alerta', () => {
    const r = detectarMargenNegativo([items[2]!]);
    expect(r.alertas).toHaveLength(0);
  });

  it('calcula el margen % sobre el precio', () => {
    const r = detectarMargenNegativo([
      { itemId: 'a', sku: 'A', descripcion: 'A', precioUsd: '20', costoUsd: '15' },
    ]);
    expect(r.filas[0]!.margenPct).toBe('25.00'); // (20-15)/20
    expect(r.filas[0]!.negativo).toBe(false);
  });
});
