import { Decimal, REDONDEO_FISCAL } from './decimal-config';

/**
 * Código de moneda de la operación (ISO-like). Abierto a criptos: 'VES', 'USD',
 * 'EUR', 'USDT', ... Ver regla 10 de CLAUDE.md (cada línea guarda su `currency_code`).
 */
export type CodigoMoneda = string;

/** Entradas aceptadas para construir un `Money` (regla 1: nunca un float silencioso). */
export type MoneyInput = string | Decimal | Money | number;

/** Pesos aceptados para repartos proporcionales (cantidades adimensionales). */
export type Peso = string | Decimal | Money;

const PATRON_MONEDA = /^[A-Z0-9]{1,12}$/;

function normalizarMoneda(moneda: CodigoMoneda): CodigoMoneda {
  const m = moneda.trim().toUpperCase();
  if (!PATRON_MONEDA.test(m)) {
    throw new Error(`Código de moneda inválido: "${moneda}"`);
  }
  return m;
}

function pesoADecimal(peso: Peso): Decimal {
  if (peso instanceof Money) return peso.aDecimal();
  if (peso instanceof Decimal) return new Decimal(peso);
  return new Decimal(peso);
}

/**
 * Monto de dinero inmutable y tipado por moneda, sobre decimal.js (regla 1 de CLAUDE.md).
 *
 * - Precisión interna completa; el redondeo a 2 decimales ocurre SOLO en presentación /
 *   documentos fiscales vía {@link Money.redondearFiscal}, nunca en el almacenamiento intermedio.
 * - Operar o comparar `Money` de monedas distintas lanza: previene el bug catastrófico de
 *   mezclar bases (VES fiscal / USD gerencial / origen).
 * - La conversión entre monedas (aplicar tasa BCV) NO vive aquí: es responsabilidad de la
 *   capa de tasas (P4) y del ledger (P3), que conocen `exchange_rate_id`.
 */
export class Money {
  private readonly valor: Decimal;
  readonly moneda: CodigoMoneda;

  private constructor(valor: Decimal, moneda: CodigoMoneda) {
    this.valor = valor;
    this.moneda = moneda;
  }

  /** Construye un `Money`. Preferir `string`/`Decimal`; `number` solo si es entero seguro. */
  static of(valor: MoneyInput, moneda: CodigoMoneda): Money {
    const m = normalizarMoneda(moneda);

    if (valor instanceof Money) {
      return new Money(new Decimal(valor.valor), m);
    }
    if (typeof valor === 'number') {
      if (!Number.isInteger(valor) || !Number.isSafeInteger(valor)) {
        throw new Error(
          `Money.of no acepta number con decimales o no seguro (riesgo de float): ${valor}. Usa string.`,
        );
      }
      return new Money(new Decimal(valor), m);
    }

    let d: Decimal;
    try {
      d = new Decimal(valor as string | Decimal);
    } catch {
      throw new Error(`Valor monetario inválido: ${String(valor)}`);
    }
    if (!d.isFinite()) {
      throw new Error(`Valor monetario no finito: ${String(valor)}`);
    }
    return new Money(d, m);
  }

  /** Cero en la moneda dada. */
  static cero(moneda: CodigoMoneda): Money {
    return new Money(new Decimal(0), normalizarMoneda(moneda));
  }

  private assertMismaMoneda(otro: Money): void {
    if (otro.moneda !== this.moneda) {
      throw new Error(`No se pueden operar monedas distintas: ${this.moneda} vs ${otro.moneda}`);
    }
  }

  // --- Operaciones (devuelven nuevo Money, misma moneda) -------------------

  suma(otro: Money): Money {
    this.assertMismaMoneda(otro);
    return new Money(this.valor.plus(otro.valor), this.moneda);
  }

  resta(otro: Money): Money {
    this.assertMismaMoneda(otro);
    return new Money(this.valor.minus(otro.valor), this.moneda);
  }

  /** Multiplica por un escalar (p.ej. cantidad × precio). No se multiplica Money × Money. */
  multiplicar(factor: string | Decimal | number): Money {
    return new Money(this.valor.times(new Decimal(factor)), this.moneda);
  }

  /** Divide por un escalar. Usa la precisión configurada (40 sig.). */
  dividir(divisor: string | Decimal | number): Money {
    const d = new Decimal(divisor);
    if (d.isZero()) throw new Error('División por cero');
    return new Money(this.valor.div(d), this.moneda);
  }

  negado(): Money {
    return new Money(this.valor.negated(), this.moneda);
  }

  valorAbsoluto(): Money {
    return new Money(this.valor.abs(), this.moneda);
  }

  // --- Comparaciones -------------------------------------------------------

  /** -1 si this < otro, 0 si iguales, 1 si this > otro. */
  comparar(otro: Money): -1 | 0 | 1 {
    this.assertMismaMoneda(otro);
    return this.valor.comparedTo(otro.valor) as -1 | 0 | 1;
  }

  igualA(otro: Money): boolean {
    return this.comparar(otro) === 0;
  }
  mayorQue(otro: Money): boolean {
    return this.comparar(otro) === 1;
  }
  menorQue(otro: Money): boolean {
    return this.comparar(otro) === -1;
  }
  mayorOIgual(otro: Money): boolean {
    return this.comparar(otro) >= 0;
  }
  menorOIgual(otro: Money): boolean {
    return this.comparar(otro) <= 0;
  }
  esCero(): boolean {
    return this.valor.isZero();
  }
  esPositivo(): boolean {
    return this.valor.isPositive() && !this.valor.isZero();
  }
  esNegativo(): boolean {
    return this.valor.isNegative() && !this.valor.isZero();
  }

  // --- Redondeo ------------------------------------------------------------

  /** Redondeo fiscal half-up a `decimales` (default 2). Presentación / documentos fiscales. */
  redondearFiscal(decimales = 2): Money {
    return new Money(this.valor.toDecimalPlaces(decimales, REDONDEO_FISCAL), this.moneda);
  }

  /** Redondeo half-up a 8 decimales: límite de almacenamiento `NUMERIC(20,8)`. */
  redondearAlmacenamiento(): Money {
    return new Money(this.valor.toDecimalPlaces(8, REDONDEO_FISCAL), this.moneda);
  }

  // --- Distribución proporcional sin perder céntimos -----------------------

  /**
   * Reparte este monto (redondeado fiscalmente a `decimales`) en partes proporcionales a
   * `pesos`, por el **método del mayor residuo**: la suma de las partes es EXACTAMENTE igual
   * al total redondeado (jamás se pierde ni se inventa un céntimo). Sign-robusto (totales
   * negativos como notas de crédito reparten correctamente).
   *
   * @throws si `pesos` está vacío, algún peso es negativo, o la suma de pesos es cero.
   */
  prorratear(pesos: ReadonlyArray<Peso>, decimales = 2): Money[] {
    if (pesos.length === 0) {
      throw new Error('prorratear requiere al menos un peso');
    }
    const pesosDec = pesos.map(pesoADecimal);
    if (pesosDec.some((p) => p.isNegative())) {
      throw new Error('Los pesos del prorrateo no pueden ser negativos');
    }
    const sumaPesos = pesosDec.reduce((a, b) => a.plus(b), new Decimal(0));
    if (sumaPesos.isZero()) {
      throw new Error('La suma de los pesos del prorrateo no puede ser cero');
    }

    // Trabajamos en "céntimos" enteros para repartir sin error.
    const unidad = new Decimal(10).pow(-decimales); // 0.01 para decimales=2
    const totalCent = this.valor.toDecimalPlaces(decimales, REDONDEO_FISCAL).div(unidad); // entero exacto

    const partes = pesosDec.map((peso, index) => {
      const exacto = totalCent.times(peso).div(sumaPesos);
      const base = exacto.floor();
      return { index, base, residuo: exacto.minus(base) };
    });

    const sumaBases = partes.reduce((a, p) => a.plus(p.base), new Decimal(0));
    const sobrante = totalCent.minus(sumaBases).toNumber(); // entero no negativo y < n

    // El sobrante se reparte de a un céntimo a las partidas de mayor residuo.
    const orden = [...partes].sort((a, b) => {
      const c = b.residuo.comparedTo(a.residuo);
      return c !== 0 ? c : a.index - b.index;
    });
    const extra = new Array<number>(partes.length).fill(0);
    for (let i = 0; i < sobrante; i++) {
      const objetivo = orden[i];
      if (objetivo) extra[objetivo.index] = 1;
    }

    return partes.map((p) => {
      const centavos = p.base.plus(extra[p.index] ?? 0);
      return new Money(centavos.times(unidad), this.moneda);
    });
  }

  /** Reparte en `n` partes iguales que suman exactamente el total (p.ej. cuotas). */
  repartirIgual(n: number, decimales = 2): Money[] {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Número de partes inválido: ${n}`);
    }
    return this.prorratear(new Array<string>(n).fill('1'), decimales);
  }

  // --- Serialización -------------------------------------------------------

  /** Copia del Decimal interno (precisión completa). */
  aDecimal(): Decimal {
    return new Decimal(this.valor);
  }

  /** Número con precisión completa, sin moneda, para persistir en `NUMERIC(20,8)`. */
  aCadenaDecimal(): string {
    return this.valor.toFixed();
  }

  /** Representación canónica para logs: "100.5 VES". */
  toString(): string {
    return `${this.valor.toFixed()} ${this.moneda}`;
  }

  toJSON(): { amount: string; currency: CodigoMoneda } {
    return { amount: this.valor.toFixed(), currency: this.moneda };
  }
}
