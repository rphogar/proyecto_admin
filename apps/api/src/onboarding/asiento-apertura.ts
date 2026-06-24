import { type EntradaAsiento, type EntradaLinea, balancearConRedondeo } from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO del ASIENTO DE APERTURA de una empresa (P30, docs/03 §1–2, regla 7/10; caso 45).
 * Sin IO: 100% testeable. Arma el asiento en triple base (VES fiscal / USD gerencial / origen) a
 * partir de los saldos iniciales que el asistente captura: caja, bancos, CxC/CxP por tercero,
 * inventario (con costo y fecha de origen para reexpresión) y capital.
 *
 * Cuadre triple base — el reto multimoneda:
 *  - VES (base fiscal) y USD (base gerencial): ΣD = ΣC SIEMPRE.
 *  - ORIGEN: ΣD = ΣC **por cada moneda** (regla del ledger, `verificarCuadre`). Un patrimonio único en
 *    Bs no puede cuadrar el origen de los activos en USD/EUR. Por eso la apertura se cuadra por
 *    **bucket de moneda**: dentro de cada moneda, los activos/pasivos se compensan con una línea de
 *    PATRIMONIO en esa misma moneda. En el bucket VES esa contrapartida es el **capital** (3.1) más el
 *    plug de **resultados acumulados** (3.3); en los demás buckets, todo va a 3.3. La línea de
 *    patrimonio lleva el residual EXACTO de su bucket en las tres bases, así que el asiento cuadra
 *    sin tolerancia. `balancearConRedondeo` queda como red de seguridad para el céntimo.
 *
 * Política de cuadre (confirmada con el usuario): la diferencia entre activos−pasivos y el capital
 * capturado se imputa a **3.3 Resultados acumulados** (resultados de ejercicios anteriores), dejando
 * el asiento balanceado y trazado.
 */

/** Cuenta de capital social (docs/03 §2). */
export const CUENTA_CAPITAL = '3.1';
/** Cuenta de resultados acumulados: absorbe el residual de apertura (plug). */
export const CUENTA_RESULTADOS_ACUMULADOS = '3.3';
/** Cuenta totalizadora de inventarios (hoja en el plan base); recibe el valor de apertura. */
export const CUENTA_INVENTARIO = '1.4';

const DEC2 = 2;

function r2(d: Decimal): string {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL).toFixed(DEC2);
}

/** Naturaleza del saldo: activo (saldo deudor → D) o pasivo (saldo acreedor → C). */
export type NaturalezaApertura = 'ACTIVO' | 'PASIVO';

/** Un renglón de saldo inicial. El inventario añade itemId/warehouseId/cantidad/fechaOrigen. */
export interface RenglonApertura {
  readonly naturaleza: NaturalezaApertura;
  /** Código de cuenta de movimiento (hoja) del plan. */
  readonly cuenta: string;
  /** Moneda del saldo (VES, USD, EUR, USDT, …). */
  readonly moneda: string;
  /** Monto en moneda origen (> 0). */
  readonly montoOrigen: string;
  /** Tasa BCV Bs/moneda de la apertura; null si `moneda` = VES. */
  readonly rateBcv: string | null;
  /** Tercero (CxC/CxP por tercero). */
  readonly partyId?: string;
  /** Vencimiento de la CxC/CxP (YYYY-MM-DD). */
  readonly vencimiento?: string;
  // --- Inventario (genera además un stock_move APERTURA) ---
  readonly itemId?: string;
  readonly warehouseId?: string;
  /** Cantidad de inventario (> 0); el costo unitario se deriva del monto / cantidad. */
  readonly cantidad?: string;
  /** Fecha de origen de la partida no monetaria (reexpresión, docs/03 §3); YYYY-MM-DD. */
  readonly fechaOrigen?: string;
}

export interface EntradaApertura {
  readonly fecha: InstanteUtc;
  readonly descripcion?: string;
  readonly renglones: ReadonlyArray<RenglonApertura>;
  /** Capital social inicial en VES (>= 0); se acredita a 3.1 dentro del bucket VES. */
  readonly capitalVes: string;
  /** Tasa gerencial Bs/USD de la apertura (> 0). */
  readonly rateUsdMgmt: string;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/** Movimiento de inventario de apertura a registrar como stock_move (doble base). */
export interface MovimientoInventarioApertura {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly cantidad: string;
  readonly costoUnitVes: string;
  readonly costoUnitUsd: string;
  readonly valorVes: string;
  readonly valorUsd: string;
  readonly rateBcv: string | null;
  readonly fechaOrigen: string;
}

export interface ResultadoApertura {
  readonly entradaAsiento: EntradaAsiento;
  readonly movimientosInventario: ReadonlyArray<MovimientoInventarioApertura>;
}

interface Triple {
  readonly origen: Decimal;
  readonly ves: Decimal;
  readonly usd: Decimal;
}

function expandir(montoOrigen: Decimal, moneda: string, rateBcv: Decimal | null, rateUsdMgmt: Decimal): Triple {
  const m = moneda.trim().toUpperCase();
  if (m !== 'VES' && rateBcv === null) {
    throw new Error(`asiento de apertura: falta rateBcv para la moneda ${m}`);
  }
  const ves = m === 'VES' ? montoOrigen : montoOrigen.times(rateBcv as Decimal);
  // USD nativo conserva su monto; las demás monedas se valoran por la tasa gerencial.
  const usd = m === 'USD' ? montoOrigen : ves.div(rateUsdMgmt);
  return { origen: montoOrigen, ves, usd };
}

interface LineaConTriple {
  readonly entrada: EntradaLinea;
  readonly dc: 'D' | 'C';
  readonly t: Triple;
}

/**
 * Construye el asiento de apertura (POSTED) y la lista de movimientos de inventario.
 * @throws si no hay renglones, si una moneda distinta de VES no trae rateBcv, o si la tasa gerencial
 * no es > 0.
 */
export function construirAsientoApertura(entrada: EntradaApertura): ResultadoApertura {
  const rateUsdMgmt = new Decimal(entrada.rateUsdMgmt);
  if (!rateUsdMgmt.isFinite() || rateUsdMgmt.lte(0)) {
    throw new Error('asiento de apertura: rateUsdMgmt debe ser > 0');
  }
  if (entrada.renglones.length === 0) {
    throw new Error('asiento de apertura: se requiere al menos un saldo inicial');
  }

  const lineasOperativas: LineaConTriple[] = [];
  const movimientosInventario: MovimientoInventarioApertura[] = [];

  for (const r of entrada.renglones) {
    const rateBcv = r.rateBcv === null || r.rateBcv === undefined ? null : new Decimal(r.rateBcv);
    const t = expandir(new Decimal(r.montoOrigen), r.moneda, rateBcv, rateUsdMgmt);
    const dc: 'D' | 'C' = r.naturaleza === 'ACTIVO' ? 'D' : 'C';

    lineasOperativas.push({
      dc,
      t,
      entrada: {
        cuenta: r.cuenta,
        dc,
        moneda: r.moneda,
        montoOrigen: r2(t.origen),
        montoVes: r2(t.ves),
        montoUsdMgmt: r2(t.usd),
        ...(rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {}),
        rateUsdMgmt: rateUsdMgmt.toFixed(),
        ...(r.partyId !== undefined ? { partyId: r.partyId } : {}),
        ...(r.vencimiento !== undefined ? { vencimiento: r.vencimiento } : {}),
      },
    });

    if (r.itemId !== undefined) {
      if (r.warehouseId === undefined || r.cantidad === undefined || r.fechaOrigen === undefined) {
        throw new Error('asiento de apertura: el inventario requiere warehouseId, cantidad y fechaOrigen');
      }
      const cantidad = new Decimal(r.cantidad);
      if (!cantidad.isFinite() || cantidad.lte(0)) {
        throw new Error('asiento de apertura: la cantidad de inventario debe ser > 0');
      }
      movimientosInventario.push({
        itemId: r.itemId,
        warehouseId: r.warehouseId,
        cantidad: cantidad.toFixed(),
        costoUnitVes: t.ves.div(cantidad).toFixed(8),
        costoUnitUsd: t.usd.div(cantidad).toFixed(8),
        valorVes: r2(t.ves),
        valorUsd: r2(t.usd),
        rateBcv: rateBcv === null ? null : rateBcv.toFixed(),
        fechaOrigen: r.fechaOrigen,
      });
    }
  }

  const lineas: EntradaLinea[] = lineasOperativas.map((l) => l.entrada);

  // Patrimonio por bucket de moneda. El bucket VES lleva además el capital social (3.1).
  const monedas = [...new Set(lineasOperativas.map((l) => l.entrada.moneda.toUpperCase()))];
  const capitalVes = new Decimal(entrada.capitalVes);
  if (!capitalVes.isFinite() || capitalVes.lt(0)) {
    throw new Error('asiento de apertura: el capital en VES no puede ser negativo');
  }

  for (const moneda of monedas) {
    const delGrupo = lineasOperativas.filter((l) => l.entrada.moneda.toUpperCase() === moneda);
    let debeOrigen = new Decimal(0);
    let haberOrigen = new Decimal(0);
    let debeVes = new Decimal(0);
    let haberVes = new Decimal(0);
    let debeUsd = new Decimal(0);
    let haberUsd = new Decimal(0);
    for (const l of delGrupo) {
      // Los montos de la línea son cadenas decimales (r2); se reconstruyen a Decimal para sumar.
      const origen = new Decimal(String(l.entrada.montoOrigen));
      const ves = new Decimal(String(l.entrada.montoVes));
      const usd = new Decimal(String(l.entrada.montoUsdMgmt));
      if (l.dc === 'D') {
        debeOrigen = debeOrigen.plus(origen);
        debeVes = debeVes.plus(ves);
        debeUsd = debeUsd.plus(usd);
      } else {
        haberOrigen = haberOrigen.plus(origen);
        haberVes = haberVes.plus(ves);
        haberUsd = haberUsd.plus(usd);
      }
    }

    // En el bucket VES, el capital social es un haber operativo antes de calcular el plug.
    if (moneda === 'VES' && capitalVes.gt(0)) {
      const capitalUsd = capitalVes.div(rateUsdMgmt);
      lineas.push({
        cuenta: CUENTA_CAPITAL,
        dc: 'C',
        moneda: 'VES',
        montoOrigen: r2(capitalVes),
        montoVes: r2(capitalVes),
        montoUsdMgmt: r2(capitalUsd),
        rateUsdMgmt: rateUsdMgmt.toFixed(),
      });
      haberOrigen = haberOrigen.plus(new Decimal(r2(capitalVes)));
      haberVes = haberVes.plus(new Decimal(r2(capitalVes)));
      haberUsd = haberUsd.plus(new Decimal(r2(capitalUsd)));
    }

    // Plug de patrimonio (3.3): residual EXACTO del bucket en las tres bases.
    const residOrigen = debeOrigen.minus(haberOrigen);
    const residVes = debeVes.minus(haberVes);
    const residUsd = debeUsd.minus(haberUsd);
    if (residOrigen.isZero() && residVes.isZero() && residUsd.isZero()) {
      continue;
    }
    // Si los activos del bucket superan a pasivos+capital → falta un haber (3.3 al haber).
    const dcPlug: 'D' | 'C' = residOrigen.gte(0) ? 'C' : 'D';
    lineas.push({
      cuenta: CUENTA_RESULTADOS_ACUMULADOS,
      dc: dcPlug,
      moneda,
      montoOrigen: residOrigen.abs().toFixed(),
      montoVes: residVes.abs().toFixed(),
      montoUsdMgmt: residUsd.abs().toFixed(),
      rateUsdMgmt: rateUsdMgmt.toFixed(),
    });
  }

  // Red de seguridad para el céntimo (los plugs ya cuadran exacto; esto absorbe cualquier residuo).
  const balanceadas = balancearConRedondeo(lineas);

  return {
    entradaAsiento: {
      fecha: entrada.fecha,
      descripcion: entrada.descripcion ?? 'Asiento de apertura',
      lineas: balanceadas,
      sourceType: 'APERTURA',
      estado: 'POSTED',
      ...(entrada.companyId !== undefined ? { companyId: entrada.companyId } : {}),
      ...(entrada.sourceId !== undefined ? { sourceId: entrada.sourceId } : {}),
    },
    movimientosInventario,
  };
}
