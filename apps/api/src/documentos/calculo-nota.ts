import type { EntradaAsiento, EntradaLinea } from '@contave/ledger';
import { Decimal, type InstanteUtc } from '@contave/shared';
import {
  CUENTA_CLIENTES_DIVISA,
  CUENTA_CLIENTES_VES,
  CUENTA_IVA_DEBITO,
  cuentaVentas,
  type DocumentoCalculado,
} from './calculo-documento';

/**
 * Asientos de NOTA DE CRÉDITO (docs/03 §5, docs/02 §6.1; casos 8, 17, 18).
 *
 * La NOTA DE CRÉDITO es el **reverso** de la venta: anula (total) o reduce (parcial, por líneas o %)
 * una factura emitida. Su asiento invierte los lados de la factura —D Ventas por alícuota (base),
 * D IVA débito fiscal (Σ IVA), C Clientes por el total— y se construye **a la tasa de la fecha de la
 * NC** (caso 8): el cálculo (`calcularDocumento`) ya viene resuelto a esa tasa, de modo que el
 * asiento cuadra en las tres bases por construcción y el neto fiscal por alícuota del libro de
 * ventas del mes de la NC sale correcto.
 *
 * La NOTA DE DÉBITO (cargo adicional) tiene el mismo sentido contable que una venta y se contabiliza
 * con la plantilla aditiva `armarAsientoFacturaVenta(..., { sourceType: 'NOTA_DEBITO' })`.
 *
 * TODO-TRIBUTARISTA: si la NC reduce una CxC nacida a OTRA tasa, queda un diferencial cambiario
 * entre el valor de carga (tasa de la factura) y el de la NC (tasa de la NC). Aquí el asiento se
 * arma autoconsistente a la tasa de la NC; la reconciliación contra el valor de carga de la CxC
 * (línea de ajuste a 4.7/6.7) y si la NC reduce CxC vs genera reembolso a caja se decide en el
 * servicio según el documento 03 (pendiente de validación profesional).
 */

export interface OpcionesAsientoNota {
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly moneda: string;
  readonly rateBcv: string | null;
  readonly rateUsdMgmt: string;
  readonly partyId?: string | null;
  readonly companyId?: string;
  readonly sourceId?: string;
  /** Asiento de la factura afectada, para la cadena de reverso (informativo). */
  readonly reversalOf?: string;
}

/**
 * Arma el asiento de una NOTA DE CRÉDITO (reverso de la venta). D Ventas por alícuota (base) ;
 * D IVA débito fiscal (Σ IVA) ; C Clientes (total). Cuentas por CÓDIGO; el servicio las resuelve a
 * id. Cuadra en las tres bases por construcción (es el espejo exacto de la factura).
 */
export function armarAsientoNotaCredito(calc: DocumentoCalculado, opciones: OpcionesAsientoNota): EntradaAsiento {
  const moneda = opciones.moneda.trim().toUpperCase();
  const esVes = moneda === 'VES';
  const rateBcv = opciones.rateBcv;
  const rateUsdMgmt = opciones.rateUsdMgmt;
  const party = opciones.partyId ?? undefined;

  const lineas: EntradaLinea[] = [];

  // Debe: Ventas por alícuota (base imponible) — reversa el ingreso reconocido en la factura.
  for (const t of calc.impuestos) {
    lineas.push({
      cuenta: cuentaVentas(t.alicuotaCodigo),
      dc: 'D',
      moneda,
      montoOrigen: t.baseOrigen,
      montoVes: t.baseVes,
      montoUsdMgmt: t.baseUsdMgmt,
      ...(rateBcv !== null ? { rateBcv } : {}),
      rateUsdMgmt,
    });
  }

  // Debe: IVA débito fiscal (suma de todos los grupos), si hubo causación — reversa el débito.
  const ivaOrigen = calc.impuestos.reduce((a, t) => a.plus(t.montoOrigen), new Decimal(0));
  const ivaVes = calc.impuestos.reduce((a, t) => a.plus(t.montoVes), new Decimal(0));
  const ivaUsd = calc.impuestos.reduce((a, t) => a.plus(t.montoUsdMgmt), new Decimal(0));
  if (ivaVes.gt(0)) {
    lineas.push({
      cuenta: CUENTA_IVA_DEBITO,
      dc: 'D',
      moneda,
      montoOrigen: ivaOrigen.toFixed(),
      montoVes: ivaVes.toFixed(),
      montoUsdMgmt: ivaUsd.toFixed(),
      ...(rateBcv !== null ? { rateBcv } : {}),
      rateUsdMgmt,
    });
  }

  // Haber: Clientes por el total (base + IVA) — reduce la cuenta por cobrar.
  lineas.push({
    cuenta: esVes ? CUENTA_CLIENTES_VES : CUENTA_CLIENTES_DIVISA,
    dc: 'C',
    moneda,
    montoOrigen: calc.totales.totalOrigen,
    montoVes: calc.totales.totalVes,
    montoUsdMgmt: calc.totales.totalUsdMgmt,
    ...(rateBcv !== null ? { rateBcv } : {}),
    rateUsdMgmt,
    ...(party !== undefined ? { partyId: party } : {}),
  });

  return {
    fecha: opciones.fecha,
    descripcion: opciones.descripcion,
    lineas,
    sourceType: 'NOTA_CREDITO',
    estado: 'DRAFT',
    ...(opciones.companyId !== undefined ? { companyId: opciones.companyId } : {}),
    ...(opciones.sourceId !== undefined ? { sourceId: opciones.sourceId } : {}),
    ...(opciones.reversalOf !== undefined ? { reversalOf: opciones.reversalOf } : {}),
  };
}
