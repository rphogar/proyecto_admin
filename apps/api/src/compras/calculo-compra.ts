import {
  baseIslrDeLineas,
  calcularRetencionIva,
  calcularRetencionIslr,
  type PorcentajeRetencionIva,
} from '@contave/fiscal-engine';
import type { EntradaAsiento, EntradaLinea } from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';
import {
  calcularDocumento,
  type DocumentoCalculado,
  type LineaBorrador,
} from '../documentos/calculo-documento';

/**
 * Cálculo PURO de una factura de COMPRA con retenciones (P9, docs/02 §3.3/§4, docs/03 §5). Sin IO:
 * 100% testeable.
 *
 * Reutiliza {@link calcularDocumento} para expandir las líneas a la triple base y agrupar el IVA
 * (crédito fiscal) por alícuota, y añade:
 *  - **Retención de IVA** del agente (75/100) sobre el IVA de la factura.
 *  - **Retención de ISLR** por concepto, sobre la porción gravada (`baseIslr`), con sustraendo.
 *  - El **asiento** de la compra: D destino (base) + D IVA crédito (1.3.01) ; C Proveedores (2.1) por
 *    el NETO ; C Retención IVA por enterar (2.3.03) y C Retención ISLR por enterar (2.3.04). Cuadra
 *    en las tres bases por construcción (el neto se obtiene por diferencia).
 *
 * Las tarifas/porcentajes/sustraendo llegan como PARÁMETROS resueltos (maestro del tercero +
 * `fiscal_params`); este módulo no conoce las tablas (regla 17). Todos los importes de retención se
 * calculan en la moneda ORIGEN del documento y se expanden a VES/USD con las tasas congeladas, de
 * modo que el asiento cuadra. TODO-TRIBUTARISTA: para facturas en divisa, precisar la expresión en
 * Bs de la retención (aquí: equivalente a tasa BCV congelada).
 */

const CUENTA_IVA_CREDITO = '1.3.01';
const CUENTA_PROVEEDORES = '2.1';
const CUENTA_RET_IVA_POR_ENTERAR = '2.3.03';
const CUENTA_RET_ISLR_POR_ENTERAR = '2.3.04';

function r2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, REDONDEO_FISCAL);
}

/** Triple base de un monto en moneda origen. */
interface Triple {
  origen: string;
  ves: string;
  usd: string;
}

function expandir(montoOrigen: Decimal, moneda: string, rateBcv: Decimal | null, rateUsdMgmt: Decimal): Triple {
  const m = moneda.trim().toUpperCase();
  const ves = m === 'VES' ? montoOrigen : montoOrigen.times(rateBcv ?? new Decimal(0));
  const usd = m === 'USD' ? montoOrigen : ves.div(rateUsdMgmt);
  return { origen: r2(montoOrigen).toFixed(2), ves: r2(ves).toFixed(2), usd: r2(usd).toFixed(2) };
}

/** Datos de retención de IVA a aplicar (ya resuelto el porcentaje, ver porcentajeRetencionIva). */
export interface RetencionIvaParams {
  readonly aplica: boolean;
  readonly porcentaje: PorcentajeRetencionIva;
}

/** Datos de retención de ISLR a aplicar. */
export interface RetencionIslrParams {
  readonly aplica: boolean;
  readonly concepto: string;
  readonly tarifa: string;
  /** Sustraendo en moneda origen (PN residente); 0 para PJ. */
  readonly sustraendo?: string | null;
  /** Base gravada por el concepto en moneda origen; default = base imponible total del documento. */
  readonly base?: string | null;
  /**
   * Marca por línea (alineada con `lineas`) de cuáles están sujetas a la retención de ISLR del
   * concepto (caso 32: solo la porción de servicio). Si se omite `base` y se pasa esto, la base de
   * ISLR se obtiene sumando las líneas marcadas; si ninguna se marca, se usa el total (conservador,
   * TODO-TRIBUTARISTA). `base` explícito tiene prioridad.
   */
  readonly lineasSujetas?: ReadonlyArray<boolean>;
}

export interface BorradorCompra {
  readonly moneda: string;
  readonly rateBcv: string | null;
  readonly rateUsdMgmt: string;
  readonly cuentaDestino: string;
  readonly lineas: ReadonlyArray<LineaBorrador>;
  readonly retencionIva?: RetencionIvaParams;
  readonly retencionIslr?: RetencionIslrParams;
}

export interface RetencionCalculada {
  readonly aplica: boolean;
  readonly porcentaje: string;
  readonly base: Triple;
  readonly sustraendo: Triple;
  readonly monto: Triple;
}

export interface CompraCalculada {
  readonly documento: DocumentoCalculado;
  readonly retencionIva: RetencionCalculada;
  readonly retencionIslr: RetencionCalculada & {
    readonly concepto: string | null;
    /** true si la base de ISLR se tomó del total por falta de discriminación por línea (caso 32). */
    readonly baseSinDiscriminar: boolean;
  };
  /** Neto a pagar al proveedor (total − retenciones) en triple base. */
  readonly netoProveedor: Triple;
}

const SIN_RETENCION: RetencionCalculada = {
  aplica: false,
  porcentaje: '0',
  base: { origen: '0.00', ves: '0.00', usd: '0.00' },
  sustraendo: { origen: '0.00', ves: '0.00', usd: '0.00' },
  monto: { origen: '0.00', ves: '0.00', usd: '0.00' },
};

/** Calcula líneas/IVA crédito, retenciones y neto al proveedor de una compra. */
export function calcularCompra(borrador: BorradorCompra): CompraCalculada {
  const moneda = borrador.moneda.trim().toUpperCase();
  const rateBcv = borrador.rateBcv === null ? null : new Decimal(borrador.rateBcv);
  const rateUsdMgmt = new Decimal(borrador.rateUsdMgmt);

  const documento = calcularDocumento({
    tipo: 'COMPRA',
    moneda,
    rateBcv: borrador.rateBcv,
    rateUsdMgmt: borrador.rateUsdMgmt,
    lineas: borrador.lineas,
  });

  const ivaTotalOrigen = documento.impuestos.reduce((a, t) => a.plus(t.montoOrigen), new Decimal(0));
  const baseTotalOrigen = documento.impuestos.reduce((a, t) => a.plus(t.baseOrigen), new Decimal(0));

  // ── Retención de IVA (75/100 sobre el IVA de la factura) ──
  let retIva = SIN_RETENCION;
  if (borrador.retencionIva?.aplica === true && ivaTotalOrigen.gt(0)) {
    const r = calcularRetencionIva({ ivaFactura: ivaTotalOrigen.toFixed(), porcentaje: borrador.retencionIva.porcentaje });
    const monto = new Decimal(r.ivaRetenido);
    retIva = {
      aplica: monto.gt(0),
      porcentaje: r.porcentaje,
      base: expandir(new Decimal(r.ivaFactura), moneda, rateBcv, rateUsdMgmt),
      sustraendo: SIN_RETENCION.sustraendo,
      monto: expandir(monto, moneda, rateBcv, rateUsdMgmt),
    };
  }

  // ── Retención de ISLR (por concepto, con sustraendo) ──
  let retIslr: RetencionCalculada & { concepto: string | null; baseSinDiscriminar: boolean } = {
    ...SIN_RETENCION,
    concepto: null,
    baseSinDiscriminar: false,
  };
  if (borrador.retencionIslr?.aplica === true) {
    // Base de ISLR: explícita > por línea (caso 32) > total del documento.
    let baseIslr: Decimal;
    let baseSinDiscriminar = false;
    if (borrador.retencionIslr.base != null) {
      baseIslr = new Decimal(borrador.retencionIslr.base);
    } else if (borrador.retencionIslr.lineasSujetas !== undefined) {
      const filas = documento.lineas.map((l, i) => ({ base: l.baseOrigen, sujetoIslr: borrador.retencionIslr!.lineasSujetas![i] === true }));
      const rb = baseIslrDeLineas(filas);
      baseIslr = new Decimal(rb.base);
      baseSinDiscriminar = rb.usoTotalPorFaltaDeDiscriminacion;
    } else {
      baseIslr = baseTotalOrigen;
      baseSinDiscriminar = true;
    }
    const r = calcularRetencionIslr({
      base: baseIslr.toFixed(),
      tarifa: borrador.retencionIslr.tarifa,
      sustraendo: borrador.retencionIslr.sustraendo ?? '0',
    });
    const monto = new Decimal(r.retencion);
    retIslr = {
      aplica: monto.gt(0),
      porcentaje: r.tarifa,
      base: expandir(new Decimal(r.base), moneda, rateBcv, rateUsdMgmt),
      sustraendo: expandir(new Decimal(r.sustraendo), moneda, rateBcv, rateUsdMgmt),
      monto: expandir(monto, moneda, rateBcv, rateUsdMgmt),
      concepto: borrador.retencionIslr.concepto,
      baseSinDiscriminar,
    };
  }

  // Neto al proveedor = total − retenciones (por base, así el asiento cuadra exactamente).
  const neto: Triple = {
    origen: restar3(documento.totales.totalOrigen, retIva.monto.origen, retIslr.monto.origen),
    ves: restar3(documento.totales.totalVes, retIva.monto.ves, retIslr.monto.ves),
    usd: restar3(documento.totales.totalUsdMgmt, retIva.monto.usd, retIslr.monto.usd),
  };

  return { documento, retencionIva: retIva, retencionIslr: retIslr, netoProveedor: neto };
}

function restar3(total: string, a: string, b: string): string {
  return new Decimal(total).minus(a).minus(b).toFixed(2);
}

export interface OpcionesAsientoCompra {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly moneda: string;
  readonly rateBcv: string | null;
  readonly rateUsdMgmt: string;
  readonly cuentaDestino: string;
  readonly partyId?: string | null;
  readonly companyId?: string;
  readonly sourceId?: string;
}

/**
 * Arma el asiento de la compra (cuentas por CÓDIGO; el servicio las resuelve a id):
 *   D destino (base imponible + exenta)  ·  D 1.3.01 IVA crédito (Σ IVA)
 *   C 2.1 Proveedores (neto)  ·  C 2.3.03 Ret. IVA por enterar  ·  C 2.3.04 Ret. ISLR por enterar
 * Cuadra en las tres bases por construcción.
 */
export function armarAsientoCompra(calc: CompraCalculada, opciones: OpcionesAsientoCompra): EntradaAsiento {
  const moneda = opciones.moneda.trim().toUpperCase();
  const rateBcv = opciones.rateBcv;
  const rateUsdMgmt = opciones.rateUsdMgmt;
  const party = opciones.partyId ?? undefined;
  const conRate = rateBcv !== null ? { rateBcv } : {};

  const lineas: EntradaLinea[] = [];
  const { documento, retencionIva, retencionIslr, netoProveedor } = calc;

  // Debe: destino (toda la base, gravada + exenta + exportación). Una sola cuenta de destino.
  const baseOrigen = documento.impuestos.reduce((a, t) => a.plus(t.baseOrigen), new Decimal(0));
  const baseVes = documento.impuestos.reduce((a, t) => a.plus(t.baseVes), new Decimal(0));
  const baseUsd = documento.impuestos.reduce((a, t) => a.plus(t.baseUsdMgmt), new Decimal(0));
  lineas.push({
    cuenta: opciones.cuentaDestino,
    dc: 'D',
    moneda,
    montoOrigen: baseOrigen.toFixed(),
    montoVes: baseVes.toFixed(),
    montoUsdMgmt: baseUsd.toFixed(),
    ...conRate,
    rateUsdMgmt,
  });

  // Debe: IVA crédito fiscal (Σ IVA), si hubo causación.
  const ivaOrigen = documento.impuestos.reduce((a, t) => a.plus(t.montoOrigen), new Decimal(0));
  const ivaVes = documento.impuestos.reduce((a, t) => a.plus(t.montoVes), new Decimal(0));
  const ivaUsd = documento.impuestos.reduce((a, t) => a.plus(t.montoUsdMgmt), new Decimal(0));
  if (ivaVes.gt(0)) {
    lineas.push({
      cuenta: CUENTA_IVA_CREDITO,
      dc: 'D',
      moneda,
      montoOrigen: ivaOrigen.toFixed(),
      montoVes: ivaVes.toFixed(),
      montoUsdMgmt: ivaUsd.toFixed(),
      ...conRate,
      rateUsdMgmt,
    });
  }

  // Haber: Proveedores por el neto (total − retenciones).
  lineas.push({
    cuenta: CUENTA_PROVEEDORES,
    dc: 'C',
    moneda,
    montoOrigen: netoProveedor.origen,
    montoVes: netoProveedor.ves,
    montoUsdMgmt: netoProveedor.usd,
    ...conRate,
    rateUsdMgmt,
    ...(party !== undefined ? { partyId: party } : {}),
  });

  // Haber: retención de IVA por enterar (pasivo del agente).
  if (retencionIva.aplica) {
    lineas.push({
      cuenta: CUENTA_RET_IVA_POR_ENTERAR,
      dc: 'C',
      moneda,
      montoOrigen: retencionIva.monto.origen,
      montoVes: retencionIva.monto.ves,
      montoUsdMgmt: retencionIva.monto.usd,
      ...conRate,
      rateUsdMgmt,
    });
  }

  // Haber: retención de ISLR por enterar (pasivo del agente).
  if (retencionIslr.aplica) {
    lineas.push({
      cuenta: CUENTA_RET_ISLR_POR_ENTERAR,
      dc: 'C',
      moneda,
      montoOrigen: retencionIslr.monto.origen,
      montoVes: retencionIslr.monto.ves,
      montoUsdMgmt: retencionIslr.monto.usd,
      ...conRate,
      rateUsdMgmt,
    });
  }

  return {
    fecha: opciones.fecha,
    descripcion: opciones.descripcion,
    lineas,
    sourceType: 'COMPRA',
    estado: 'DRAFT',
    ...(opciones.companyId !== undefined ? { companyId: opciones.companyId } : {}),
    ...(opciones.sourceId !== undefined ? { sourceId: opciones.sourceId } : {}),
  };
}

export {
  CUENTA_IVA_CREDITO,
  CUENTA_PROVEEDORES,
  CUENTA_RET_IVA_POR_ENTERAR,
  CUENTA_RET_ISLR_POR_ENTERAR,
};
