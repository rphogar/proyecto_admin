/**
 * Generador del archivo TXT de RETENCIONES DE IVA para el portal SENIAT (Providencia 0049; docs/02
 * §3.3; caso 33 del doc 07). Función PURA y determinista.
 *
 * El agente carga periódicamente (quincenal) un archivo de texto con una línea por documento
 * retenido. El formato es **delimitado por TAB**, sin encabezado, una fila por documento, con los
 * campos en el orden del "Proceso de Carga" de retenciones de IVA del portal. Los montos van en
 * bolívares con 2 decimales y separador decimal **coma** (formato venezolano del portal), sin
 * separador de miles. Las fechas en `DD/MM/AAAA`. El período impositivo en `AAAAMM`.
 *
 * Columnas (perfil {@link PERFIL_SENIAT_CLASICO}, en este orden):
 *   1  RIF del agente de retención
 *   2  Período impositivo (AAAAMM)
 *   3  RIF del sujeto retenido (proveedor)
 *   4  Número de comprobante de retención (AAAAMMNNNNNNNN)
 *   5  Fecha del documento (DD/MM/AAAA)
 *   6  Tipo de transacción (01 registro / 02 ajuste / 03 anulación)
 *   7  Tipo de documento (01 factura / 02 nota de débito / 03 nota de crédito)
 *   8  Número de documento (factura del proveedor)
 *   9  Número de control del documento
 *   10 Número de documento afectado (NC/ND); vacío si no aplica
 *   11 Total compra incluyendo IVA (Bs)
 *   12 Compras sin derecho a crédito fiscal / exento (Bs)
 *   13 Base imponible (Bs)
 *   14 Alícuota (%)
 *   15 Impuesto IVA (Bs)
 *   16 IVA retenido (Bs)
 *   17 Porcentaje de retención (75 / 100)
 *
 * ⚠️ TODO-TRIBUTARISTA / caso 33: el layout exacto (orden de columnas, delimitador, formato de
 * montos, presencia del período y del % de retención, y catálogo de tipos) cambia entre versiones
 * del portal y DEBE validarse contra un **archivo de ejemplo real anonimizado** antes de producción;
 * un rechazo del portal es un caso de soporte crítico. El golden `txt-retencion-iva.ejemplo.txt`
 * fija el layout asumido; reemplazarlo por el archivo real del portal cuando se disponga de él. El
 * generador es parametrizable (separador, fin de línea, formato de fecha) para adaptarlo sin tocar
 * los llamadores.
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
  /**
   * Período impositivo `AAAAMM`. Si se omite, se deriva de los primeros 6 dígitos del número de
   * comprobante (que ya codifica el período de imputación).
   */
  readonly periodo?: string;
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
  /** Compras sin derecho a crédito fiscal / exento (Bs); default 0. */
  readonly comprasSinCredito?: string | null;
  /** Base imponible (Bs). */
  readonly baseImponible: string;
  /** Alícuota aplicada en % (p. ej. 16). */
  readonly alicuota: string;
  /** IVA del documento (Bs). */
  readonly impuestoIva: string;
  /** IVA retenido (Bs). */
  readonly ivaRetenido: string;
  /** Porcentaje de retención aplicado (75 / 100). */
  readonly porcentajeRetencion: string;
}

export interface OpcionesTxt {
  /** Separador de campos (default TAB). */
  readonly separador?: string;
  /** Terminador de línea (default CRLF, como espera el portal en Windows). */
  readonly finDeLinea?: string;
  /** Formato de fecha: 'DDMMAAAA' (DD/MM/AAAA, default) o 'AAAAMMDD' (AAAA-MM-DD). */
  readonly formatoFecha?: 'DDMMAAAA' | 'AAAAMMDD';
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

/** Fecha en hora civil (la fecha ya viene como fecha fiscal `YYYY-MM-DD` o ISO). */
function fechaTxt(valor: string, formato: 'DDMMAAAA' | 'AAAAMMDD'): string {
  const soloFecha = valor.slice(0, 10); // 'YYYY-MM-DD'.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(soloFecha);
  if (m === null) {
    throw new Error(`generarTxtRetencionIva: fecha inválida para el TXT: ${valor}`);
  }
  return formato === 'AAAAMMDD' ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

/** Período `AAAAMM`: explícito o derivado de los 6 primeros dígitos del número de comprobante. */
function periodoTxt(linea: LineaRetencionIvaTxt): string {
  const p = (linea.periodo ?? linea.numeroComprobante.slice(0, 6)).trim();
  if (!/^\d{6}$/.test(p)) {
    throw new Error(`generarTxtRetencionIva: período impositivo inválido (AAAAMM): ${p}`);
  }
  return p;
}

/** Porcentaje de retención entero (75 / 100). */
function porcentajeTxt(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`generarTxtRetencionIva: porcentaje de retención inválido: ${valor}`);
  }
  return String(Math.round(n));
}

/**
 * Genera el contenido TXT de un lote de retenciones de IVA (una línea por documento retenido).
 * Devuelve la cadena lista para escribir como archivo (sin BOM).
 */
export function generarTxtRetencionIva(lineas: ReadonlyArray<LineaRetencionIvaTxt>, opciones: OpcionesTxt = {}): string {
  const sep = opciones.separador ?? '\t';
  const eol = opciones.finDeLinea ?? '\r\n';
  const formatoFecha = opciones.formatoFecha ?? 'DDMMAAAA';

  const filas = lineas.map((l) => {
    const campos = [
      l.rifAgente.trim(),
      periodoTxt(l),
      l.rifRetenido.trim(),
      l.numeroComprobante.trim(),
      fechaTxt(l.fechaDocumento, formatoFecha),
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
      porcentajeTxt(l.porcentajeRetencion),
    ];
    if (campos.some((c) => c.includes(sep))) {
      throw new Error('generarTxtRetencionIva: un campo contiene el separador; datos inválidos');
    }
    return campos.join(sep);
  });

  return filas.join(eol);
}
