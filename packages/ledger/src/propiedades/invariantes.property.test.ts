import { Decimal } from '@contave/shared';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { Asiento } from '../asientos/asiento';
import { verificarCuadre } from '../asientos/cuadre';
import type { EntradaLinea } from '../asientos/linea';
import { balancearConRedondeo } from '../asientos/redondeo';
import { LibroDePeriodos, PeriodoCerradoError } from '../periodos/periodo';
import { postear } from '../posting/posting';

/**
 * Property tests (fast-check) de los invariantes del ledger (regla 1/6/9 de CLAUDE.md,
 * docs/05 §7.1) y los casos 9, 24 y 42 de docs/07. La correspondencia es:
 *   - regla 1 (Decimal, sin floats) + caso 9 (redondeo extremo)  → cuadre exacto tras redondeo.
 *   - regla 6 (consecutividad/atomicidad) + caso 24 (corte de luz) → posteo todo-o-nada.
 *   - regla 9 (períodos cerrados) + caso 42 (asiento en período cerrado) → posteo solo si abierto.
 */

const FECHA = '2026-01-15T12:00:00.000Z'; // Caracas 08:00 → período 2026-01

/** Genera un conjunto de líneas que cuadra trivialmente en las tres bases (todas en VES). */
const lineasBalanceadas: fc.Arbitrary<EntradaLinea[]> = fc
  .array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 4 })
  .map((centsCreditos) => {
    const creditos = centsCreditos.map((c) => new Decimal(c).div(100));
    const total = creditos.reduce((a, b) => a.plus(b), new Decimal(0));
    const debito: EntradaLinea = {
      cuenta: '1.1.01',
      dc: 'D',
      moneda: 'VES',
      montoOrigen: total.toFixed(),
      montoVes: total.toFixed(),
      montoUsdMgmt: total.toFixed(),
    };
    const lineasCredito: EntradaLinea[] = creditos.map((c) => ({
      cuenta: '4.6',
      dc: 'C',
      moneda: 'VES',
      montoOrigen: c.toFixed(),
      montoVes: c.toFixed(),
      montoUsdMgmt: c.toFixed(),
    }));
    return [debito, ...lineasCredito];
  });

describe('Invariante central: todo asiento construido cuadra en triple base (docs/05 §7.1)', () => {
  it('ΣD=ΣC en VES, USD y origen para cualquier asiento balanceado', () => {
    fc.assert(
      fc.property(lineasBalanceadas, (lineas) => {
        const asiento = Asiento.construir({ fecha: FECHA, descripcion: 'gen', lineas });
        const cuadre = verificarCuadre(asiento.lineas);
        return cuadre.balanceado && asiento.totalDebeVes().igualA(asiento.totalHaberVes());
      }),
    );
  });
});

describe('regla 1 + caso 9 — redondeo extremo: cuadre exacto, residuo ≤ 0,01', () => {
  // Origen en USD que cuadra exacto; al convertir a VES con tasa de 8 decimales el redondeo
  // por línea deja un residuo de céntimos que el motor ajusta sin descuadrar (regla 11).
  const escenarioRedondeo = fc.record({
    rateEnt: fc.integer({ min: 1, max: 10_000_000_000 }), // /1e8 → tasa con 8 decimales
    creditosMili: fc.array(fc.integer({ min: 1, max: 10_000_000 }), {
      minLength: 1,
      maxLength: 6,
    }), // /1000 → montos USD con 3 decimales
  });

  it('el asiento siempre cuadra tras balancearConRedondeo y el ajuste es ≤ 0,01', () => {
    fc.assert(
      fc.property(escenarioRedondeo, ({ rateEnt, creditosMili }) => {
        const rate = new Decimal(rateEnt).div(100_000_000); // 8 decimales
        const creditos = creditosMili.map((m) => new Decimal(m).div(1000)); // USD, 3 decimales
        const total = creditos.reduce((a, b) => a.plus(b), new Decimal(0));

        const aVes = (usd: Decimal): string =>
          usd.times(rate).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed();

        const debito: EntradaLinea = {
          cuenta: '1.1.02',
          dc: 'D',
          moneda: 'USD',
          montoOrigen: total.toFixed(),
          montoVes: aVes(total),
          montoUsdMgmt: total.toFixed(),
        };
        const lineasCredito: EntradaLinea[] = creditos.map((c) => ({
          cuenta: '4.6',
          dc: 'C',
          moneda: 'USD',
          montoOrigen: c.toFixed(),
          montoVes: aVes(c),
          montoUsdMgmt: c.toFixed(),
        }));

        const lineas = [debito, ...lineasCredito];
        const balanceadas = balancearConRedondeo(lineas);
        const asiento = Asiento.construir({ fecha: FECHA, descripcion: 'redondeo', lineas: balanceadas });

        const cuadra = verificarCuadre(asiento.lineas).balanceado;
        const ajustes = balanceadas.filter((l) => l.esAjuste);
        const ajusteAcotado = ajustes.every((a) =>
          new Decimal(a.montoVes).abs().lessThanOrEqualTo('0.01'),
        );
        return cuadra && ajusteAcotado;
      }),
    );
  });
});

describe('regla 6 + caso 24 — atomicidad: el asiento es todo-o-nada', () => {
  it('una sola línea corrupta aborta el asiento completo (no hay asiento parcial)', () => {
    fc.assert(
      fc.property(
        lineasBalanceadas,
        fc.nat(),
        fc.integer({ min: 1, max: 100_000 }),
        (lineas, idxRaw, deltaCent) => {
          const i = idxRaw % lineas.length;
          const delta = new Decimal(deltaCent).div(100); // ≥ 0,01: rompe el cuadre (tolerancia 0)
          const corruptas = lineas.map((l, j) =>
            j === i
              ? { ...l, montoVes: new Decimal(l.montoVes).plus(delta).toFixed() }
              : l,
          );

          let asiento: Asiento | null = null;
          let lanzo = false;
          try {
            asiento = Asiento.construir({ fecha: FECHA, descripcion: 'corrupto', lineas: corruptas });
          } catch {
            lanzo = true;
          }
          // Todo o nada: o lanzó y no hay asiento, o (imposible aquí) cuadró.
          return lanzo && asiento === null;
        },
      ),
    );
  });
});

describe('regla 9 + caso 42 — período cerrado: se postea solo si está abierto', () => {
  it('postear tiene éxito sii el período de la fecha está abierto', () => {
    fc.assert(
      fc.property(lineasBalanceadas, fc.constantFrom('OPEN', 'CLOSED' as const), (lineas, estado) => {
        const asiento = Asiento.construir({ fecha: FECHA, descripcion: 'periodo', lineas });
        const periodos = LibroDePeriodos.desde([{ anio: 2026, mes: 1, estado }]);

        let posteado: Asiento | null = null;
        let cerrado = false;
        try {
          posteado = postear(asiento, { periodos });
        } catch (e) {
          if (e instanceof PeriodoCerradoError) cerrado = true;
          else throw e;
        }

        return estado === 'OPEN'
          ? posteado?.estado === 'POSTED' && !cerrado
          : posteado === null && cerrado;
      }),
    );
  });
});
