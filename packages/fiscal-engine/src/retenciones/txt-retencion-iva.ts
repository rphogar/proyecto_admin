/**
 * Generador del archivo TXT de RETENCIONES DE IVA para el portal SENIAT (Providencia 0049; docs/02
 * §3.3; caso 33 del doc 07). Función PURA y determinista.
 *
 * El agente carga periódicamente (quincenal) un archivo de texto con una línea por documento
 * retenido. El formato es **delimitado por TAB**, sin encabezado, con los campos en el orden que
 * exige el "Proceso de Carga" de retenciones de IVA del portal. Los montos van en bolívares con 2
 * decimales y separador de decimales **coma** (formato venezolano del portal), sin separador de
 * miles. Las fechas en `DD/MM/AAAA`.
 *
 * ⚠️ TODO-TRIBUTARISTA / caso 33: el layout exacto (orden de columnas, delimitador, formato de
 * montos y catálogo de tipos) cambia entre versiones del portal y DEBE validarse contra un archivo
 * de ejemplo real antes de producción; un rechazo del portal es un caso de soporte crítico. Esta
 * implementación sigue el layout clásico documentado y se mantiene parametrizable.
 */

/** Tipo de documento retenido (catálogo SENIAT). */
export type TipoDocumentoTxt = '01' | '02' | '03'; // 01 factura, 02 nota débito, 03 nota crédito.
/** Tipo de transacción. */
export type TipoTransaccionTxt = '01' | '02' | '03'; // 01 registro, 02 ajuste, 03 anulación.

export interface LineaRetencionIvaTxt {
  /** RIF del agente retenedor (la empresa). */
  readonly rifAgente: string;
  /** RIF del retenido (proveedor). */
  readonly rifRetenido: string;
  /** Número de comprobante `AAAAMMNNNNNNNN`. */
  readonly numeroComprobante: string;
  /** Fecha del documento retenido (instante o `YYYY-MM-DD`). */
  readonly fechaDocumento: string;
  /** Tipo de transacción (default '01' registro). */
  readonly tipoTransaccion?: TipoTransaccionTxt;
  /** Tipo de documento (default '01' factura). */
  readonly tipoDocumento?: TipoDocumentoTxt;
  /** Número de la factura/documento del proveedor. */
  readonly numeroDocumento: string;
  /** Número de control del documento del proveedor. */
  readonly numeroControl: string;
  /** Número del documento afectado (NC/ND); vacío si no aplica. */
  readonly numeroDocumentoAfectado?: string | null;
  /** Total de la compra incluyendo IVA (Bs). */
  readonly totalCompraConIva: string;
  /** Compras sin derecho a crédito fiscal (Bs); default 0. */
  readonly comprasSinCredito?: string | null;
  /** Base imponible (Bs). */
  readonly baseImponible: string;
  /** Alícuota aplicada en % (p. ej. 16). */
  readonly alicuota: string;
  /** IVA del documento (Bs). */
  readonly impuestoIva: string;
  /** IVA retenido (Bs). */
  readonly ivaRetenido: string;
}

export interface OpcionesTxt {
  /** Separador de campos (default TAB). */
  readonly separador?: string;
  /** Terminador de línea (default CRLF, como espera el portal en Windows). */
  readonly finDeLinea?: string;
}

const DOS_DECIMALES = /^-?\d+(\.\d+)?$/;

/** Monto Bs con 2 decimales y coma decimal (formato del portal). */
function montoTxt(valor: string | null | undefined): string {
  const s = String(valor ?? '0').trim();
  if (!DOS_DECIMALES.test(s)) {
    throw new Error(`generarTxtRetencionIva: monto inválido para el TXT: ${s}`);
  }
  return Number(s).toFixed(2).replace('.', ',');
}

/** Fecha `DD/MM/AAAA` en hora civil (la fecha ya viene como fecha fiscal `YYYY-MM-DD` o ISO). */
function fechaTxt(valor: string): string {
  const soloFecha = valor.slice(0, 10); // 'YYYY-MM-DD'.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(soloFecha);
  if (m === null) {
    throw new Error(`generarTxtRetencionIva: fecha inválida para el TXT: ${valor}`);
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Genera el contenido TXT de un lote de retenciones de IVA (una línea por documento retenido).
 * Devuelve la cadena lista para escribir como archivo (sin BOM).
 */
export function generarTxtRetencionIva(lineas: ReadonlyArray<LineaRetencionIvaTxt>, opciones: OpcionesTxt = {}): string {
  const sep = opciones.separador ?? '\t';
  const eol = opciones.finDeLinea ?? '\r\n';

  const filas = lineas.map((l) => {
    const campos = [
      l.rifAgente.trim(),
      l.rifRetenido.trim(),
      l.numeroComprobante.trim(),
      fechaTxt(l.fechaDocumento),
      l.tipoTransaccion ?? '01',
      l.tipoDocumento ?? '01',
      l.numeroDocumento.trim(),
      l.numeroControl.trim(),
      (l.numeroDocumentoAfectado ?? '').trim(),
      montoTxt(l.totalCompraConIva),
      montoTxt(l.comprasSinCredito),
      montoTxt(l.baseImponible),
      String(Number(l.alicuota)),
      montoTxt(l.impuestoIva),
      montoTxt(l.ivaRetenido),
    ];
    if (campos.some((c) => c.includes(sep))) {
      throw new Error('generarTxtRetencionIva: un campo contiene el separador; datos inválidos');
    }
    return campos.join(sep);
  });

  return filas.join(eol);
}
