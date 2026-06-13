import type { AlicuotaCodigo, TipoDocumento } from '@contave/fiscal-engine';
import type { EntradaAsiento, EntradaLinea } from '@contave/ledger';
import { Decimal, type InstanteUtc, REDONDEO_FISCAL } from '@contave/shared';

/**
 * Cálculo PURO de un documento: expande cada línea a la triple base (regla 10), agrega el IVA por
 * alícuota (fuente de `document_taxes`) y arma el asiento de la factura de venta (docs/03 §5).
 *
 * No es el motor de IVA (prorrata, alícuotas vigentes, IGTF; eso es P7): la `alicuotaTasa` llega
 * como parámetro ya resuelto (del ítem / `fiscal_params`). Aquí solo se hace la aritmética
 * multimoneda determinista y el redondeo fiscal (half-up 2 decimales) a nivel de documento, de modo
 * que el asiento cuadre exactamente en las tres bases por construcción (totales = Σ de los grupos
 * ya redondeados). Sin IO: 100% testeable.
 */

const DEC2 = 2;
const DEC8 = 8;

function r2(d: Decimal): Decimal {
  return d.toDecimalPlaces(DEC2, REDONDEO_FISCAL);
}
function r8(d: Decimal): Decimal {
  return d.toDecimalPlaces(DEC8, REDONDEO_FISCAL);
}

/** Línea del borrador a calcular (montos en moneda origen, como Decimal-string). */
export interface LineaBorrador {
  readonly itemId?: string | null;
  readonly descripcion: string;
  readonly cantidad: string;
  readonly precioUnitarioOrigen: string;
  readonly descuentoOrigen?: string | null;
  readonly alicuotaCodigo: AlicuotaCodigo;
  /** Tasa de IVA en puntos porcentuales: '16', '8', '0'. */
  readonly alicuotaTasa: string;
}

/** Borrador de documento para el cálculo. */
export interface BorradorCalculo {
  readonly tipo: TipoDocumento;
  readonly moneda: string;
  /** Bs por unidad de `moneda`; obligatorio si `moneda` ≠ VES. */
  readonly rateBcv: string | null;
  /** Tasa gerencial Bs/USD (> 0). */
  readonly rateUsdMgmt: string;
  readonly lineas: ReadonlyArray<LineaBorrador>;
}

export interface LineaCalculada {
  readonly lineaNo: number;
  readonly itemId: string | null;
  readonly descripcion: string;
  readonly cantidad: string;
  readonly precioUnitarioOrigen: string;
  readonly descuentoOrigen: string;
  readonly alicuotaCodigo: AlicuotaCodigo;
  readonly alicuotaTasa: string;
  readonly baseOrigen: string;
  readonly baseVes: string;
  readonly baseUsdMgmt: string;
  readonly ivaOrigen: string;
  readonly ivaVes: string;
  readonly ivaUsdMgmt: string;
}

export interface ImpuestoCalculado {
  readonly alicuotaCodigo: AlicuotaCodigo;
  readonly alicuotaTasa: string;
  readonly baseOrigen: string;
  readonly baseVes: string;
  readonly baseUsdMgmt: string;
  readonly montoOrigen: string;
  readonly montoVes: string;
  readonly montoUsdMgmt: string;
}

export interface TotalesCalculados {
  readonly totalOrigen: string;
  readonly totalVes: string;
  readonly totalUsdMgmt: string;
}

export interface DocumentoCalculado {
  readonly lineas: LineaCalculada[];
  readonly impuestos: ImpuestoCalculado[];
  readonly totales: TotalesCalculados;
}

interface Triple {
  origen: Decimal;
  ves: Decimal;
  usd: Decimal;
}

/** Expande un monto en moneda origen a la triple base (docs/03 §4.1). */
function expandir(montoOrigen: Decimal, moneda: string, rateBcv: Decimal | null, rateUsdMgmt: Decimal): Triple {
  const m = moneda.trim().toUpperCase();
  const ves = m === 'VES' ? montoOrigen : montoOrigen.times(requerirTasa(rateBcv, 'rateBcv'));
  const usd = m === 'USD' ? montoOrigen : ves.div(rateUsdMgmt);
  return { origen: montoOrigen, ves, usd };
}

function requerirTasa(d: Decimal | null, nombre: string): Decimal {
  if (d === null) {
    throw new Error(`Falta la tasa ${nombre} para un documento en divisa`);
  }
  return d;
}

/** Calcula líneas (triple base), impuestos por alícuota y totales, con redondeo fiscal a 2 dec. */
export function calcularDocumento(borrador: BorradorCalculo): DocumentoCalculado {
  if (borrador.lineas.length === 0) {
    throw new Error('El documento no tiene líneas');
  }
  const moneda = borrador.moneda.trim().toUpperCase();
  const rateBcv = borrador.rateBcv === null ? null : new Decimal(borrador.rateBcv);
  const rateUsdMgmt = new Decimal(borrador.rateUsdMgmt);
  if (!rateUsdMgmt.isFinite() || rateUsdMgmt.lte(0)) {
    throw new Error('rateUsdMgmt debe ser > 0');
  }
  if (moneda !== 'VES' && (rateBcv === null || rateBcv.lte(0))) {
    throw new Error('Documento en divisa requiere rateBcv > 0');
  }

  const lineas: LineaCalculada[] = [];
  // Acumuladores por alícuota en PRECISIÓN COMPLETA; el redondeo fiscal se hace al cerrar el grupo.
  const grupos = new Map<string, { tasa: string; base: Triple; iva: Triple }>();

  borrador.lineas.forEach((l, i) => {
    const cantidad = new Decimal(l.cantidad);
    const precio = new Decimal(l.precioUnitarioOrigen);
    const descuento = new Decimal(l.descuentoOrigen ?? '0');
    const tasa = new Decimal(l.alicuotaTasa);

    const baseOrigen = cantidad.times(precio).minus(descuento);
    if (baseOrigen.isNegative()) {
      throw new Error(`Línea ${i + 1}: el descuento supera el subtotal (base negativa)`);
    }
    const ivaOrigen = baseOrigen.times(tasa).div(100);

    const base = expandir(baseOrigen, moneda, rateBcv, rateUsdMgmt);
    const iva = expandir(ivaOrigen, moneda, rateBcv, rateUsdMgmt);

    lineas.push({
      lineaNo: i + 1,
      itemId: l.itemId ?? null,
      descripcion: l.descripcion,
      cantidad: cantidad.toFixed(),
      precioUnitarioOrigen: precio.toFixed(),
      descuentoOrigen: descuento.toFixed(),
      alicuotaCodigo: l.alicuotaCodigo,
      alicuotaTasa: tasa.toFixed(DEC2),
      baseOrigen: r8(base.origen).toFixed(),
      baseVes: r8(base.ves).toFixed(),
      baseUsdMgmt: r8(base.usd).toFixed(),
      ivaOrigen: r8(iva.origen).toFixed(),
      ivaVes: r8(iva.ves).toFixed(),
      ivaUsdMgmt: r8(iva.usd).toFixed(),
    });

    const g = grupos.get(l.alicuotaCodigo) ?? {
      tasa: tasa.toFixed(DEC2),
      base: { origen: new Decimal(0), ves: new Decimal(0), usd: new Decimal(0) },
      iva: { origen: new Decimal(0), ves: new Decimal(0), usd: new Decimal(0) },
    };
    g.base.origen = g.base.origen.plus(base.origen);
    g.base.ves = g.base.ves.plus(base.ves);
    g.base.usd = g.base.usd.plus(base.usd);
    g.iva.origen = g.iva.origen.plus(iva.origen);
    g.iva.ves = g.iva.ves.plus(iva.ves);
    g.iva.usd = g.iva.usd.plus(iva.usd);
    grupos.set(l.alicuotaCodigo, g);
  });

  // Impuestos por alícuota, redondeados fiscalmente (2 dec). Orden estable por código.
  const impuestos: ImpuestoCalculado[] = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo, g]) => ({
      alicuotaCodigo: codigo as AlicuotaCodigo,
      alicuotaTasa: g.tasa,
      // Importes fiscales del documento: redondeados a 2 decimales (Bs) con forma uniforme.
      baseOrigen: r2(g.base.origen).toFixed(DEC2),
      baseVes: r2(g.base.ves).toFixed(DEC2),
      baseUsdMgmt: r2(g.base.usd).toFixed(DEC2),
      montoOrigen: r2(g.iva.origen).toFixed(DEC2),
      montoVes: r2(g.iva.ves).toFixed(DEC2),
      montoUsdMgmt: r2(g.iva.usd).toFixed(DEC2),
    }));

  // Totales = Σ (base + IVA) de los grupos YA redondeados ⇒ el asiento cuadra exactamente.
  const totales = impuestos.reduce(
    (acc, t) => ({
      totalOrigen: acc.totalOrigen.plus(t.baseOrigen).plus(t.montoOrigen),
      totalVes: acc.totalVes.plus(t.baseVes).plus(t.montoVes),
      totalUsdMgmt: acc.totalUsdMgmt.plus(t.baseUsdMgmt).plus(t.montoUsdMgmt),
    }),
    { totalOrigen: new Decimal(0), totalVes: new Decimal(0), totalUsdMgmt: new Decimal(0) },
  );

  return {
    lineas,
    impuestos,
    totales: {
      totalOrigen: totales.totalOrigen.toFixed(DEC2),
      totalVes: totales.totalVes.toFixed(DEC2),
      totalUsdMgmt: totales.totalUsdMgmt.toFixed(DEC2),
    },
  };
}

// ── Asiento de la factura de venta (precursor de las plantillas de contabilización, docs/03 §5) ──

/** Cuenta de clientes según la moneda del documento (Bs vs divisas). */
export const CUENTA_CLIENTES_VES = '1.2.01';
export const CUENTA_CLIENTES_DIVISA = '1.2.02';
/** IVA débito fiscal (pasivo). */
export const CUENTA_IVA_DEBITO = '2.3.01';

/** Cuenta de ingreso por alícuota (docs/03 §2). Compartida por la factura y las NC/ND. */
export function cuentaVentas(codigo: AlicuotaCodigo): string {
  switch (codigo) {
    case 'REDUCIDA':
      return '4.2';
    case 'EXENTO':
    case 'EXONERADO':
      return '4.3';
    case 'EXPORTACION':
      return '4.4';
    case 'GENERAL':
    case 'ADICIONAL':
      return '4.1';
    default:
      return '4.1';
  }
}

export interface OpcionesAsientoFactura {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly moneda: string;
  readonly rateBcv: string | null;
  readonly rateUsdMgmt: string;
  readonly partyId?: string | null;
  readonly companyId?: string;
  readonly sourceId?: string;
  /** Origen del asiento; default 'FACTURA'. La NOTA_DEBITO reutiliza esta misma plantilla aditiva. */
  readonly sourceType?: string;
}

/**
 * Arma el asiento de una FACTURA de venta a partir del cálculo (cuentas por CÓDIGO; el servicio las
 * resuelve a id). D Clientes (total) ; C Ventas por alícuota (base) ; C IVA débito fiscal (Σ IVA).
 * Cuadra en las tres bases por construcción. Devuelve la `EntradaAsiento` (DRAFT) para postear.
 *
 * La NOTA_DEBITO (cargo adicional al cliente: intereses, ajuste de precio) tiene el mismo sentido
 * contable que una venta y reutiliza esta plantilla con `sourceType: 'NOTA_DEBITO'`. La NOTA_CREDITO
 * es el reverso → {@link armarAsientoNotaCredito} en `calculo-nota.ts`.
 */
export function armarAsientoFacturaVenta(calc: DocumentoCalculado, opciones: OpcionesAsientoFactura): EntradaAsiento {
  const moneda = opciones.moneda.trim().toUpperCase();
  const esVes = moneda === 'VES';
  const rateBcv = opciones.rateBcv;
  const rateUsdMgmt = opciones.rateUsdMgmt;
  const party = opciones.partyId ?? undefined;

  const lineas: EntradaLinea[] = [];

  // Debe: Clientes por el total (base + IVA).
  lineas.push({
    cuenta: esVes ? CUENTA_CLIENTES_VES : CUENTA_CLIENTES_DIVISA,
    dc: 'D',
    moneda,
    montoOrigen: calc.totales.totalOrigen,
    montoVes: calc.totales.totalVes,
    montoUsdMgmt: calc.totales.totalUsdMgmt,
    ...(rateBcv !== null ? { rateBcv } : {}),
    rateUsdMgmt,
    ...(party !== undefined ? { partyId: party } : {}),
  });

  // Haber: Ventas por alícuota (base imponible).
  for (const t of calc.impuestos) {
    lineas.push({
      cuenta: cuentaVentas(t.alicuotaCodigo),
      dc: 'C',
      moneda,
      montoOrigen: t.baseOrigen,
      montoVes: t.baseVes,
      montoUsdMgmt: t.baseUsdMgmt,
      ...(rateBcv !== null ? { rateBcv } : {}),
      rateUsdMgmt,
    });
  }

  // Haber: IVA débito fiscal (suma de todos los grupos), si hubo causación.
  const ivaOrigen = calc.impuestos.reduce((a, t) => a.plus(t.montoOrigen), new Decimal(0));
  const ivaVes = calc.impuestos.reduce((a, t) => a.plus(t.montoVes), new Decimal(0));
  const ivaUsd = calc.impuestos.reduce((a, t) => a.plus(t.montoUsdMgmt), new Decimal(0));
  if (ivaVes.gt(0)) {
    lineas.push({
      cuenta: CUENTA_IVA_DEBITO,
      dc: 'C',
      moneda,
      montoOrigen: ivaOrigen.toFixed(),
      montoVes: ivaVes.toFixed(),
      montoUsdMgmt: ivaUsd.toFixed(),
      ...(rateBcv !== null ? { rateBcv } : {}),
      rateUsdMgmt,
    });
  }

  return {
    fecha: opciones.fecha,
    descripcion: opciones.descripcion,
    lineas,
    sourceType: opciones.sourceType ?? 'FACTURA',
    estado: 'DRAFT',
    ...(opciones.companyId !== undefined ? { companyId: opciones.companyId } : {}),
    ...(opciones.sourceId !== undefined ? { sourceId: opciones.sourceId } : {}),
  };
}
