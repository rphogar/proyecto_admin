import { calcularIgtf, type ResultadoIgtf } from '@contave/fiscal-engine';
import {
  balancearConRedondeo,
  CUENTA_GANANCIA_CAMBIARIA,
  CUENTA_PERDIDA_CAMBIARIA,
  type EntradaAsiento,
  type EntradaLinea,
} from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO del cobro de una factura (docs/03 §4.2, docs/02 §5; casos 4, 5, 6 del doc 07). No es
 * el motor de IGTF (eso es `@contave/fiscal-engine`): aquí se arma el asiento del cobro en triple
 * base, integrando IGTF percibido, diferencial cambiario y vuelto. Sin IO: 100% testeable.
 *
 * Reglas duras que implementa:
 *  - El **diferencial cambiario realizado** surge cuando una CxC en divisas se cobra a una tasa
 *    distinta de la de carga: en la base VES nace ganancia (4.7) o pérdida (6.7); en la base USD no
 *    hay diferencial (caso 6). Se registra como línea de AJUSTE (`esAjuste`, excluida del cuadre por
 *    moneda origen).
 *  - El **IGTF** se causa al pago sólo sobre la porción en divisas y sólo si la empresa es perceptor
 *    (caso 4); se percibe del cliente (efectivo adicional) y se acredita a `2.3.05`.
 *  - La CxC se acredita **por la moneda de cada porción de pago** a su **tasa de carga** (la de la
 *    factura), de modo que el cuadre por moneda origen se cumple y la diferencia VES contra la tasa
 *    del cobro es justo el diferencial cambiario.
 *  - Los residuos ≤ céntimo se ajustan con {@link balancearConRedondeo} (caso 4: "el resto de
 *    céntimos va a cuenta de redondeo").
 *
 * TODO-TRIBUTARISTA: el vuelto CRUZADO (recibir USD y devolver Bs, o viceversa) implica una venta de
 * divisas embebida; aquí el asiento contabiliza el vuelto en la misma moneda recibida y la
 * calculadora {@link calcularVuelto} ofrece la sugerencia cruzada para la UI. El asiento del swap de
 * divisas explícito (par esAjuste) queda pendiente de validación profesional.
 */

const DEC2 = 2;

function r2(d: Decimal): string {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2);
}

const CUENTA_IGTF_PERCIBIDO = '2.3.05';

/** Saldo de la cuenta por cobrar que el cobro extingue (total o parcialmente). */
export interface SaldoCxC {
  /** Código de cuenta CxC ('1.2.01' Bs / '1.2.02' divisas). */
  readonly cuenta: string;
  /** Moneda de la factura (carga). */
  readonly moneda: string;
  /** Tasa BCV de carga (de la factura); null si la factura es en VES. */
  readonly rateCarryBcv: string | null;
  readonly partyId?: string | null;
}

/** Una porción del pago por un método (cuenta de caja/banco mapeada). */
export interface MedioCobro {
  /** Código de la cuenta de caja/banco del método de pago. */
  readonly cuenta: string;
  readonly moneda: string;
  readonly montoOrigen: string;
  /** Causa IGTF (divisas/cripto fuera de banca nacional). */
  readonly esDivisa: boolean;
  /** Tasa BCV de la fecha del cobro para esta moneda; null si VES. */
  readonly rateBcv: string | null;
}

/** Vuelto entregado al cliente (salida de caja), en la misma moneda recibida. */
export interface VueltoCobro {
  readonly cuenta: string;
  readonly moneda: string;
  readonly montoOrigen: string;
  readonly rateBcv: string | null;
}

export interface EntradaCobro {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly saldo: SaldoCxC;
  readonly medios: ReadonlyArray<MedioCobro>;
  readonly vuelto?: ReadonlyArray<VueltoCobro>;
  /** La empresa es SPE designada agente de percepción del IGTF. */
  readonly empresaEsPerceptor: boolean;
  /** Alícuota IGTF en %; default 3. */
  readonly alicuotaIgtf?: string;
  /** Tasa gerencial Bs/USD de la fecha del cobro. */
  readonly rateUsdMgmt: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

export interface ResultadoCobro {
  readonly igtf: ResultadoIgtf;
  /** Diferencial cambiario en VES (firmado: + ganancia, − pérdida). */
  readonly diferencialVes: string;
  /** Total aplicado a la CxC, en VES (a tasa de carga). */
  readonly aplicadoVes: string;
  readonly entradaAsiento: EntradaAsiento;
}

interface Triple {
  origen: Decimal;
  ves: Decimal;
  usd: Decimal;
}

/** Expande un monto a la triple base a la tasa indicada (del cobro o de carga). */
function expandir(monto: Decimal, moneda: string, rateBcv: Decimal | null, rateUsdMgmt: Decimal): Triple {
  const m = moneda.trim().toUpperCase();
  const ves = m === 'VES' ? monto : monto.times(requerir(rateBcv, `rateBcv de ${m}`));
  const usd = m === 'USD' ? monto : ves.div(rateUsdMgmt);
  return { origen: monto, ves, usd };
}

function requerir(d: Decimal | null, nombre: string): Decimal {
  if (d === null) throw new Error(`calcularCobro: falta ${nombre}`);
  return d;
}

/**
 * Calcula el cobro y arma su asiento POSTED-able. Cuadra en triple base por construcción (con líneas
 * de ajuste para el diferencial y el redondeo). Devuelve también el IGTF y el diferencial para la UI.
 */
export function calcularCobro(entrada: EntradaCobro): ResultadoCobro {
  const rateUsdMgmt = new Decimal(entrada.rateUsdMgmt);
  if (!rateUsdMgmt.isFinite() || rateUsdMgmt.lte(0)) {
    throw new Error('calcularCobro: rateUsdMgmt debe ser > 0');
  }
  const rateCarryBcv = entrada.saldo.rateCarryBcv === null ? null : new Decimal(entrada.saldo.rateCarryBcv);
  const lineas: EntradaLinea[] = [];

  // 1) IGTF percibido (sólo porción en divisas, sólo si perceptor) — caso 4.
  const igtf = calcularIgtf({
    metodos: entrada.medios.map((m) => ({
      moneda: m.moneda as never,
      montoOrigen: m.montoOrigen,
      esDivisa: m.esDivisa,
      rateBcv: m.rateBcv,
    })),
    empresaEsPerceptor: entrada.empresaEsPerceptor,
    ...(entrada.alicuotaIgtf !== undefined ? { alicuota: entrada.alicuotaIgtf } : {}),
  });

  // 2) Entradas de caja por método (D) — el movimiento real para el arqueo.
  for (const m of entrada.medios) {
    const rate = m.rateBcv === null ? null : new Decimal(m.rateBcv);
    const t = expandir(new Decimal(m.montoOrigen), m.moneda, rate, rateUsdMgmt);
    lineas.push(lineaCaja('D', m.cuenta, m.moneda, t, rate, rateUsdMgmt));
  }

  // 3) Vuelto entregado (C) — salida de caja en la misma moneda recibida.
  for (const v of entrada.vuelto ?? []) {
    const rate = v.rateBcv === null ? null : new Decimal(v.rateBcv);
    const t = expandir(new Decimal(v.montoOrigen), v.moneda, rate, rateUsdMgmt);
    lineas.push(lineaCaja('C', v.cuenta, v.moneda, t, rate, rateUsdMgmt));
  }

  // 4) IGTF percibido: efectivo adicional recibido en divisas (D caja) contra 2.3.05 (C).
  for (const d of igtf.detalle) {
    const rate = rateDeMoneda(entrada.medios, d.moneda);
    const t = expandir(new Decimal(d.igtf), d.moneda, rate, rateUsdMgmt);
    lineas.push(lineaCaja('D', cuentaCajaDe(entrada.medios, d.moneda), d.moneda, t, rate, rateUsdMgmt));
    lineas.push(lineaCaja('C', CUENTA_IGTF_PERCIBIDO, d.moneda, t, rate, rateUsdMgmt));
  }

  // 5) Crédito a la CxC por la moneda de cada porción NETA (entrada − vuelto), a la tasa de CARGA.
  //    La diferencia VES contra la tasa del cobro es el diferencial cambiario (paso 6).
  const netoPorMoneda = netoAplicadoPorMoneda(entrada);
  let aplicadoVes = new Decimal(0);
  for (const [moneda, neto] of netoPorMoneda) {
    if (neto.isZero()) continue;
    const carry = moneda === 'VES' ? null : rateCarryBcv;
    const t = expandir(neto, moneda, carry, rateUsdMgmt);
    aplicadoVes = aplicadoVes.plus(t.ves);
    lineas.push({
      cuenta: entrada.saldo.cuenta,
      dc: 'C',
      moneda: moneda as never,
      montoOrigen: r2(t.origen),
      montoVes: r2(t.ves),
      montoUsdMgmt: r2(t.usd),
      ...(carry !== null ? { rateBcv: carry.toFixed() } : {}),
      rateUsdMgmt: rateUsdMgmt.toFixed(),
      ...(entrada.saldo.partyId != null ? { partyId: entrada.saldo.partyId } : {}),
    });
  }

  // 6) Diferencial cambiario: residual VES (ΣD − ΣC) tras las líneas operativas. La porción > céntimo
  //    es diferencial realizado (4.7/6.7); el resto lo afina balancearConRedondeo (caso 4).
  const residualVes = residualVesDe(lineas);
  const diferencialVes = residualVes;
  if (residualVes.abs().gt('0.01')) {
    const esGanancia = residualVes.isPositive();
    lineas.push({
      cuenta: esGanancia ? CUENTA_GANANCIA_CAMBIARIA : CUENTA_PERDIDA_CAMBIARIA,
      dc: esGanancia ? 'C' : 'D',
      moneda: 'VES' as never,
      montoOrigen: r2(residualVes.abs()),
      montoVes: r2(residualVes.abs()),
      montoUsdMgmt: '0',
      esAjuste: true,
    });
  }

  const balanceadas = balancearConRedondeo(lineas);

  return {
    igtf,
    diferencialVes: r2(diferencialVes),
    aplicadoVes: r2(aplicadoVes),
    entradaAsiento: {
      fecha: entrada.fecha,
      descripcion: entrada.descripcion,
      lineas: balanceadas,
      sourceType: 'COBRO',
      estado: 'DRAFT',
      ...(entrada.companyId !== undefined ? { companyId: entrada.companyId } : {}),
      ...(entrada.sourceId !== undefined ? { sourceId: entrada.sourceId } : {}),
    },
  };
}

function lineaCaja(
  dc: 'D' | 'C',
  cuenta: string,
  moneda: string,
  t: Triple,
  rateBcv: Decimal | null,
  rateUsdMgmt: Decimal,
): EntradaLinea {
  return {
    cuenta,
    dc,
    moneda: moneda as never,
    montoOrigen: r2(t.origen),
    montoVes: r2(t.ves),
    montoUsdMgmt: r2(t.usd),
    ...(rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {}),
    rateUsdMgmt: rateUsdMgmt.toFixed(),
  };
}

/** Neto aplicado a la CxC por moneda = Σ entradas − Σ vueltos de esa moneda. */
function netoAplicadoPorMoneda(entrada: EntradaCobro): Map<string, Decimal> {
  const neto = new Map<string, Decimal>();
  for (const m of entrada.medios) {
    const k = m.moneda.trim().toUpperCase();
    neto.set(k, (neto.get(k) ?? new Decimal(0)).plus(m.montoOrigen));
  }
  for (const v of entrada.vuelto ?? []) {
    const k = v.moneda.trim().toUpperCase();
    neto.set(k, (neto.get(k) ?? new Decimal(0)).minus(v.montoOrigen));
  }
  return neto;
}

function residualVesDe(lineas: ReadonlyArray<EntradaLinea>): Decimal {
  return lineas.reduce((acc, l) => {
    const v = new Decimal(String(l.montoVes));
    return l.dc === 'D' ? acc.plus(v) : acc.minus(v);
  }, new Decimal(0));
}

function rateDeMoneda(medios: ReadonlyArray<MedioCobro>, moneda: string): Decimal | null {
  const m = medios.find((x) => x.moneda.trim().toUpperCase() === moneda.trim().toUpperCase());
  return m?.rateBcv == null ? null : new Decimal(m.rateBcv);
}

function cuentaCajaDe(medios: ReadonlyArray<MedioCobro>, moneda: string): string {
  const m = medios.find((x) => x.moneda.trim().toUpperCase() === moneda.trim().toUpperCase());
  if (!m) throw new Error(`calcularCobro: no hay método de pago para la moneda ${moneda} del IGTF`);
  return m.cuenta;
}

/**
 * Calculadora de VUELTO CRUZADO (caso 5): dado el total a cobrar y lo pagado (ambos llevados a VES),
 * sugiere el vuelto en Bs y su equivalente en USD a la tasa indicada. Pura.
 */
export function calcularVuelto(
  totalVes: string,
  pagadoVes: string,
  rateBcv: string,
): { vueltoVes: string; vueltoUsd: string } {
  const vuelto = new Decimal(pagadoVes).minus(totalVes);
  if (vuelto.isNegative()) {
    return { vueltoVes: '0.00', vueltoUsd: '0.00' };
  }
  const rate = new Decimal(rateBcv);
  return {
    vueltoVes: r2(vuelto),
    vueltoUsd: rate.lte(0) ? '0.00' : r2(vuelto.div(rate)),
  };
}
