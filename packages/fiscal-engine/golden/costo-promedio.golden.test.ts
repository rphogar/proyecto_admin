import { describe, expect, it } from 'vitest';
import { calcularKardex, type MovimientoKardex } from '../src/inventario/kardex';
import golden from './costo-promedio.golden.json';

/**
 * Golden test del costo promedio ponderado móvil en doble base (caso 37 del doc 07). Valores exactos
 * en costo-promedio.golden.json, verificados a mano. El promedio debe cuadrar en AMBAS bases (Bs/USD)
 * aunque las compras se hagan en monedas distintas (docs/03 §4.3, art. 177 Ley ISLR).
 */
describe('Costo promedio ponderado doble base — golden (doc 07 §E.37)', () => {
  it('caso 37: compras en USD y en Bs → promedio correcto en ambas bases', () => {
    const c = golden.caso37_compras_monedas_distintas;
    const k = calcularKardex(c.input.movimientos as MovimientoKardex[]);

    expect(k.saldoCantidad).toBe(c.esperado.saldoCantidad);
    expect(k.saldoValorVes).toBe(c.esperado.saldoValorVes);
    expect(k.saldoValorUsd).toBe(c.esperado.saldoValorUsd);
    expect(k.costoPromedioVes).toBe(c.esperado.costoPromedioVes);
    expect(k.costoPromedioUsd).toBe(c.esperado.costoPromedioUsd);

    // Kardex consistente fila a fila (cada renglón valora el movimiento y el saldo acumulado).
    c.esperadoFilas.forEach((esperado, i) => {
      const fila = k.filas[i]!;
      expect(fila.costoUnitVes).toBe(esperado.costoUnitVes);
      expect(fila.costoUnitUsd).toBe(esperado.costoUnitUsd);
      expect(fila.saldoCantidad).toBe(esperado.saldoCantidad);
      expect(fila.saldoValorVes).toBe(esperado.saldoValorVes);
      expect(fila.saldoValorUsd).toBe(esperado.saldoValorUsd);
      expect(fila.costoPromedioVes).toBe(esperado.costoPromedioVes);
      expect(fila.costoPromedioUsd).toBe(esperado.costoPromedioUsd);
    });

    // Invariante: valor de saldo == cantidad × costo promedio, en ambas bases (sin residuo).
    expect(Number(k.saldoValorVes)).toBeCloseTo(
      Number(k.saldoCantidad) * Number(k.costoPromedioVes),
      6,
    );
    expect(Number(k.saldoValorUsd)).toBeCloseTo(
      Number(k.saldoCantidad) * Number(k.costoPromedioUsd),
      6,
    );
  });

  it('caso 37b: la venta sale al promedio vigente y NO altera el costo promedio', () => {
    const c = golden.caso37b_venta_al_promedio;
    const k = calcularKardex(c.input.movimientos as MovimientoKardex[]);

    expect(k.saldoCantidad).toBe(c.esperado.saldoCantidad);
    expect(k.saldoValorVes).toBe(c.esperado.saldoValorVes);
    expect(k.saldoValorUsd).toBe(c.esperado.saldoValorUsd);
    expect(k.costoPromedioVes).toBe(c.esperado.costoPromedioVes);
    expect(k.costoPromedioUsd).toBe(c.esperado.costoPromedioUsd);

    // La salida se valoró exactamente al promedio que había antes de venderse.
    const venta = k.filas[2]!;
    expect(venta.costoUnitVes).toBe('2750.00000000');
    expect(venta.costoUnitUsd).toBe('10.55555556');
  });
});
