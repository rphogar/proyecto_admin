import { porcentajeRetencionIva, type PorcentajeRetencionIva } from './retencion-iva';

/**
 * Evaluación PURA de una factura de compra del proveedor para decidir, ANTES de registrar, el
 * tratamiento de retención de IVA y de **deducibilidad del crédito fiscal** (caso 29 del doc 07;
 * Providencia 0049 art. 5; requisitos 00071). Determinista, sin IO.
 *
 * Reglas:
 *  - Factura que **no discrimina el IVA** por alícuota, o proveedor con **RIF inconsistente** / no
 *    inscrito → retención de IVA al **100%** (Prov. 0049).
 *  - Factura **sin número de control** (requisito 00071) → el IVA soportado **no es deducible** como
 *    crédito fiscal y se emite **alerta**; además fuerza el 100% de retención.
 *  - Factura que no discrimina el IVA → tampoco da derecho a crédito fiscal deducible (no se puede
 *    determinar la cuota), con alerta.
 *
 * El resultado alimenta el flujo de compra: el porcentaje de retención y un flag de crédito no
 * deducible que excluye ese IVA de la planilla/libro como deducible (va al costo/gasto).
 */

export interface FacturaCompraAEvaluar {
  /** La factura discrimina el IVA por alícuota (requisito 00071). */
  readonly discriminaIva: boolean;
  /** Número de control de la factura (preimpreso/digital); vacío/ausente = incumple 00071. */
  readonly numeroControl?: string | null;
  /** RIF del proveedor inconsistente o no inscrito (datos que no coinciden). */
  readonly rifInconsistente?: boolean;
  /** % base del proveedor (75/100), del maestro del tercero. Default 75. */
  readonly pctProveedor?: PorcentajeRetencionIva | string | number | null;
}

export interface EvaluacionFacturaCompra {
  /** Porcentaje de retención de IVA a aplicar (75/100). */
  readonly pctRetencionIva: PorcentajeRetencionIva;
  /** El crédito fiscal de IVA es deducible (factura cumple requisitos). */
  readonly creditoFiscalDeducible: boolean;
  /** Alertas no bloqueantes para el usuario (motivos de no deducibilidad / 100%). */
  readonly alertas: string[];
}

/** Evalúa la factura de compra y devuelve % de retención, deducibilidad del crédito y alertas. */
export function evaluarFacturaCompra(input: FacturaCompraAEvaluar): EvaluacionFacturaCompra {
  const sinNumeroControl = input.numeroControl == null || String(input.numeroControl).trim() === '';
  const noDiscriminaIva = input.discriminaIva === false;
  const rifInconsistente = input.rifInconsistente === true;

  const pctRetencionIva = porcentajeRetencionIva({
    pctProveedor: input.pctProveedor ?? null,
    noDiscriminaIva,
    sinNumeroControl,
    rifInconsistente,
  });

  const alertas: string[] = [];
  let creditoFiscalDeducible = true;

  if (sinNumeroControl) {
    creditoFiscalDeducible = false;
    alertas.push('Factura sin número de control (00071): el crédito fiscal de IVA NO es deducible; retención de IVA al 100%.');
  }
  if (noDiscriminaIva) {
    creditoFiscalDeducible = false;
    alertas.push('Factura que no discrimina el IVA por alícuota (00071): crédito fiscal no deducible; retención de IVA al 100%.');
  }
  if (rifInconsistente) {
    alertas.push('RIF del proveedor inconsistente o no inscrito (Prov. 0049): retención de IVA al 100%.');
  }

  return { pctRetencionIva, creditoFiscalDeducible, alertas };
}
