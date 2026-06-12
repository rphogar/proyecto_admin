import { Decimal, validarRif } from '@contave/shared';

/**
 * Validador PRE-EMISIÓN de requisitos de facturación (Providencias SNAT/2011/00071 y
 * SNAT/2024/000102; arquitectura de la SNAT/2024/000121). Función PURA y determinista: recibe
 * la proyección del documento a emitir y devuelve la lista de **incumplimientos**. Lista vacía =
 * el documento cumple TODOS los requisitos y puede emitirse (regla dura §11.1 de docs/02:
 * "toda factura valida los requisitos 00071/00102 antes de emitirse; si falla un requisito, no
 * se emite"). La UI/servicio jamás decide por su cuenta: solo muestra/actúa sobre esta lista.
 *
 * Cubre los requisitos mínimos del art. 6.1 de la 00071 (denominación, numeración, número de
 * control, datos del emisor, fecha, identificación del adquirente, descripción, base e IVA
 * discriminados por alícuota, total, moneda con contravalor en Bs y tasa BCV, condición de pago)
 * y los específicos digitales de la 00102. No calcula impuestos (eso es el motor de IVA, P7):
 * recibe los importes ya discriminados y verifica su presencia, coherencia y consistencia.
 *
 * Casos del doc 07 cubiertos: 15 (consumidor final/umbral), 16 (RIF inválido), 12 (discriminación
 * por alícuota), 19 (NC/ND referencian la factura afectada).
 */

/** Tipos de documento fiscal (docs/05 §3.4). */
export type TipoDocumento =
  | 'FACTURA'
  | 'NOTA_CREDITO'
  | 'NOTA_DEBITO'
  | 'GUIA_DESPACHO'
  | 'PEDIDO'
  | 'PRESUPUESTO'
  | 'COMPRA'
  | 'NOTA_ENTREGA'
  | 'COMPROBANTE_RETENCION_IVA'
  | 'COMPROBANTE_RETENCION_ISLR';

/**
 * Medio de emisión (00071 art. 6.1): la **máquina fiscal** numera y controla por hardware (sin
 * número de control de software); las **formas libres** y la **imprenta digital** (00102) sí
 * exigen número de control. Default conservador: FORMA_LIBRE.
 */
export type MedioEmision = 'FORMA_LIBRE' | 'MAQUINA_FISCAL' | 'IMPRENTA_DIGITAL';

/** Código de alícuota de la línea/impuesto (mismo dominio que `items.alicuota_iva`). */
export type AlicuotaCodigo = 'GENERAL' | 'REDUCIDA' | 'ADICIONAL' | 'EXENTO' | 'EXONERADO' | 'EXPORTACION';

/** Norma que respalda el requisito incumplido (para trazabilidad y mensaje al usuario). */
export type Norma = 'SNAT/2011/00071' | 'SNAT/2024/000102' | 'SNAT/2024/000121';

/** Un requisito incumplido. `codigo` es estable (para tests/telemetría); `mensaje` es para el usuario. */
export interface Incumplimiento {
  readonly codigo: string;
  readonly campo: string;
  readonly mensaje: string;
  readonly norma: Norma;
}

/** Datos del emisor (empresa que factura). */
export interface EmisorAValidar {
  readonly razonSocial: string | null | undefined;
  readonly rif: string | null | undefined;
  readonly domicilioFiscal: string | null | undefined;
}

/** Datos del adquirente (cliente). */
export interface AdquirenteAValidar {
  readonly esConsumidorFinal: boolean;
  readonly rif?: string | null;
  readonly nombre?: string | null;
  /** Si el adquirente es contribuyente (ordinario/formal/especial), el RIF es siempre obligatorio. */
  readonly condicionIva?: 'ordinario' | 'formal' | 'especial' | 'no_contribuyente' | null;
}

/** Línea del documento (lo mínimo que exige el requisito de "descripción con cantidad y precio"). */
export interface LineaAValidar {
  readonly descripcion: string | null | undefined;
  readonly cantidad: string | number | null | undefined;
  readonly precioUnitario: string | number | null | undefined;
  readonly alicuotaCodigo: AlicuotaCodigo | null | undefined;
  readonly alicuotaTasa: string | number | null | undefined;
}

/** Impuesto discriminado por alícuota (la fuente única de libros y declaración, docs/05 §3.4). */
export interface ImpuestoAValidar {
  readonly alicuotaCodigo: AlicuotaCodigo;
  readonly alicuotaTasa: string | number;
  readonly base: string | number;
  readonly monto: string | number;
}

/** Referencia a la factura afectada (obligatoria en NC/ND, 00071 art. 6.1 / 00121 art. 4). */
export interface DocumentoAfectado {
  readonly numero?: string | null;
  readonly fecha?: string | Date | null;
  readonly monto?: string | number | null;
}

/** Proyección del documento a emitir que recibe el validador. */
export interface DocumentoAEmitir {
  readonly tipo: TipoDocumento;
  readonly medioEmision?: MedioEmision;
  readonly emisor: EmisorAValidar;
  readonly numeroControl?: string | null;
  readonly adquirente: AdquirenteAValidar;
  readonly fechaEmision?: string | Date | null;
  readonly moneda: string;
  /** Tasa BCV congelada (Bs por unidad de la moneda). Obligatoria si `moneda` ≠ VES. */
  readonly rateBcv?: string | number | null;
  /** Contravalor del total en Bs (verdad fiscal). Obligatorio si `moneda` ≠ VES. */
  readonly totalVes?: string | number | null;
  readonly condicionPago?: 'CONTADO' | 'CREDITO' | null;
  readonly lineas: ReadonlyArray<LineaAValidar>;
  readonly impuestos: ReadonlyArray<ImpuestoAValidar>;
  readonly total?: string | number | null;
  /** Umbral (en Bs) bajo el cual se permite "consumidor final" sin RIF (caso 15). Default 0 = siempre exige. */
  readonly umbralConsumidorFinalVes?: string | number;
  /** Referencia a la factura afectada (solo NC/ND). */
  readonly documentoAfectado?: DocumentoAfectado | null;
}

const ALICUOTAS_VALIDAS: ReadonlySet<string> = new Set<AlicuotaCodigo>([
  'GENERAL',
  'REDUCIDA',
  'ADICIONAL',
  'EXENTO',
  'EXONERADO',
  'EXPORTACION',
]);

/** Alícuotas sin causación de IVA: no generan débito, no exigen monto > 0. */
const ALICUOTAS_SIN_IVA: ReadonlySet<string> = new Set<AlicuotaCodigo>([
  'EXENTO',
  'EXONERADO',
  'EXPORTACION',
]);

/** Tipos que son documentos fiscales con requisitos completos de la 00071/00102. */
const TIPOS_FISCALES: ReadonlySet<TipoDocumento> = new Set<TipoDocumento>([
  'FACTURA',
  'NOTA_CREDITO',
  'NOTA_DEBITO',
]);

function vacio(s: string | null | undefined): boolean {
  return s === null || s === undefined || String(s).trim() === '';
}

/** Decimal seguro; `null` si la entrada no es un número finito. */
function aDecimal(v: string | number | null | undefined): Decimal | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Valida los requisitos de emisión de un documento fiscal. Devuelve TODOS los incumplimientos
 * (no corta en el primero) para que el usuario los corrija de una vez. Lista vacía ⇒ emitible.
 */
export function validarRequisitosFactura(doc: DocumentoAEmitir): Incumplimiento[] {
  const faltas: Incumplimiento[] = [];
  const add = (codigo: string, campo: string, mensaje: string, norma: Norma): void => {
    faltas.push({ codigo, campo, mensaje, norma });
  };

  // Solo FACTURA/NC/ND llevan el set completo de requisitos fiscales. Otros documentos
  // (presupuesto, pedido, guía…) no son comprobantes fiscales: no se validan aquí.
  if (!TIPOS_FISCALES.has(doc.tipo)) {
    return faltas;
  }

  // ── Emisor (00071 art. 6.1: razón social, RIF y domicilio fiscal del emisor) ──
  if (vacio(doc.emisor.razonSocial)) {
    add('EMISOR_SIN_RAZON_SOCIAL', 'emisor.razonSocial', 'Falta la razón social del emisor', 'SNAT/2011/00071');
  }
  if (vacio(doc.emisor.rif)) {
    add('EMISOR_SIN_RIF', 'emisor.rif', 'Falta el RIF del emisor', 'SNAT/2011/00071');
  } else if (!validarRif(doc.emisor.rif).valido) {
    add('EMISOR_RIF_INVALIDO', 'emisor.rif', `RIF del emisor inválido: ${String(doc.emisor.rif)}`, 'SNAT/2011/00071');
  }
  if (vacio(doc.emisor.domicilioFiscal)) {
    add('EMISOR_SIN_DOMICILIO', 'emisor.domicilioFiscal', 'Falta el domicilio fiscal del emisor', 'SNAT/2011/00071');
  }

  // ── Número de control (00071 formas libres / 00102 imprenta digital) ──
  // La máquina fiscal lo gestiona por hardware: no se exige a nivel de software.
  const medio: MedioEmision = doc.medioEmision ?? 'FORMA_LIBRE';
  if (medio !== 'MAQUINA_FISCAL' && vacio(doc.numeroControl)) {
    const norma: Norma = medio === 'IMPRENTA_DIGITAL' ? 'SNAT/2024/000102' : 'SNAT/2011/00071';
    add('SIN_NUMERO_CONTROL', 'numeroControl', 'Falta el número de control del documento', norma);
  }

  // ── Fecha de emisión ──
  if (doc.fechaEmision === null || doc.fechaEmision === undefined || String(doc.fechaEmision).trim() === '') {
    add('SIN_FECHA_EMISION', 'fechaEmision', 'Falta la fecha de emisión', 'SNAT/2011/00071');
  }

  // ── Condición de pago (contado/crédito) ──
  if (doc.condicionPago !== 'CONTADO' && doc.condicionPago !== 'CREDITO') {
    add('SIN_CONDICION_PAGO', 'condicionPago', 'Falta la condición de pago (CONTADO/CREDITO)', 'SNAT/2011/00071');
  }

  validarAdquirente(doc, add);
  validarLineas(doc, add);
  validarImpuestosYTotal(doc, add);
  validarMoneda(doc, add);

  // ── NC/ND deben referenciar la factura afectada (00071 art. 6.1 / 00121 art. 4) ──
  if (doc.tipo === 'NOTA_CREDITO' || doc.tipo === 'NOTA_DEBITO') {
    const ref = doc.documentoAfectado;
    if (!ref || vacio(ref.numero) || ref.fecha === null || ref.fecha === undefined || String(ref.fecha).trim() === '' || aDecimal(ref.monto) === null) {
      add(
        'NC_ND_SIN_FACTURA_AFECTADA',
        'documentoAfectado',
        'La nota de crédito/débito debe referenciar número, fecha y monto de la factura afectada',
        'SNAT/2024/000121',
      );
    }
  }

  return faltas;
}

function validarAdquirente(doc: DocumentoAEmitir, add: (c: string, ca: string, m: string, n: Norma) => void): void {
  const a = doc.adquirente;
  const totalVes = aDecimal(doc.totalVes) ?? (doc.moneda.trim().toUpperCase() === 'VES' ? aDecimal(doc.total) : null);
  const umbral = aDecimal(doc.umbralConsumidorFinalVes) ?? new Decimal(0);
  const esContribuyente = a.condicionIva != null && a.condicionIva !== 'no_contribuyente';

  // Un RIF presente SIEMPRE se valida (caso 16: dígito verificador), aunque sea consumidor final.
  if (!vacio(a.rif) && !validarRif(a.rif).valido) {
    add('ADQUIRENTE_RIF_INVALIDO', 'adquirente.rif', `RIF del adquirente inválido: ${String(a.rif)}`, 'SNAT/2011/00071');
  }

  if (a.esConsumidorFinal) {
    // Consumidor final permitido solo en venta al detal bajo umbral y a no contribuyentes (caso 15).
    if (esContribuyente) {
      add('CONSUMIDOR_FINAL_ES_CONTRIBUYENTE', 'adquirente', 'El adquirente es contribuyente: exige RIF y nombre, no "consumidor final"', 'SNAT/2011/00071');
    } else if (totalVes !== null && umbral.gt(0) && totalVes.gt(umbral)) {
      add('CONSUMIDOR_FINAL_SOBRE_UMBRAL', 'adquirente', `El monto supera el umbral de consumidor final (${umbral.toFixed(2)} Bs): exige identificación`, 'SNAT/2011/00071');
    } else if (umbral.lte(0)) {
      // Umbral 0 (no configurado) ⇒ nunca se permite consumidor final anónimo.
      add('CONSUMIDOR_FINAL_NO_PERMITIDO', 'adquirente', 'No hay umbral de consumidor final configurado: exige identificación del adquirente', 'SNAT/2011/00071');
    }
    return;
  }

  // Adquirente identificado: RIF y nombre obligatorios.
  if (vacio(a.rif)) {
    add('ADQUIRENTE_SIN_RIF', 'adquirente.rif', 'Falta el RIF/CI del adquirente', 'SNAT/2011/00071');
  }
  if (vacio(a.nombre)) {
    add('ADQUIRENTE_SIN_NOMBRE', 'adquirente.nombre', 'Falta el nombre/razón social del adquirente', 'SNAT/2011/00071');
  }
}

function validarLineas(doc: DocumentoAEmitir, add: (c: string, ca: string, m: string, n: Norma) => void): void {
  if (doc.lineas.length === 0) {
    add('SIN_LINEAS', 'lineas', 'El documento no tiene líneas (descripción, cantidad y precio)', 'SNAT/2011/00071');
    return;
  }
  doc.lineas.forEach((l, i) => {
    const campo = `lineas[${i}]`;
    if (vacio(l.descripcion)) {
      add('LINEA_SIN_DESCRIPCION', `${campo}.descripcion`, `Línea ${i + 1}: falta la descripción del bien/servicio`, 'SNAT/2011/00071');
    }
    const cant = aDecimal(l.cantidad);
    if (cant === null || cant.lte(0)) {
      add('LINEA_CANTIDAD_INVALIDA', `${campo}.cantidad`, `Línea ${i + 1}: la cantidad debe ser mayor que cero`, 'SNAT/2011/00071');
    }
    const precio = aDecimal(l.precioUnitario);
    if (precio === null || precio.lt(0)) {
      add('LINEA_PRECIO_INVALIDO', `${campo}.precioUnitario`, `Línea ${i + 1}: el precio unitario es inválido`, 'SNAT/2011/00071');
    }
    if (l.alicuotaCodigo == null || !ALICUOTAS_VALIDAS.has(l.alicuotaCodigo)) {
      add('LINEA_ALICUOTA_INVALIDA', `${campo}.alicuotaCodigo`, `Línea ${i + 1}: la alícuota de IVA es inválida`, 'SNAT/2011/00071');
    }
  });
}

function validarImpuestosYTotal(doc: DocumentoAEmitir, add: (c: string, ca: string, m: string, n: Norma) => void): void {
  // Base e IVA discriminados por alícuota (00071 art. 6.1, caso 12): cada alícuota presente en
  // las líneas debe tener su renglón de impuesto con base (y monto > 0 si causa IVA).
  const alicuotasEnLineas = new Set<string>();
  for (const l of doc.lineas) {
    if (l.alicuotaCodigo != null && ALICUOTAS_VALIDAS.has(l.alicuotaCodigo)) {
      alicuotasEnLineas.add(l.alicuotaCodigo);
    }
  }
  const alicuotasEnImpuestos = new Set<string>(doc.impuestos.map((t) => t.alicuotaCodigo));

  for (const cod of alicuotasEnLineas) {
    if (!alicuotasEnImpuestos.has(cod)) {
      add('IVA_NO_DISCRIMINADO', 'impuestos', `Falta discriminar la base/IVA de la alícuota ${cod}`, 'SNAT/2011/00071');
    }
  }

  let sumaBase = new Decimal(0);
  let sumaMonto = new Decimal(0);
  doc.impuestos.forEach((t, i) => {
    const base = aDecimal(t.base);
    const monto = aDecimal(t.monto);
    if (base === null || base.lt(0)) {
      add('IMPUESTO_BASE_INVALIDA', `impuestos[${i}].base`, `Base imponible inválida para la alícuota ${t.alicuotaCodigo}`, 'SNAT/2011/00071');
    } else {
      sumaBase = sumaBase.plus(base);
    }
    if (monto === null || monto.lt(0)) {
      add('IMPUESTO_MONTO_INVALIDO', `impuestos[${i}].monto`, `Monto de IVA inválido para la alícuota ${t.alicuotaCodigo}`, 'SNAT/2011/00071');
    } else {
      sumaMonto = sumaMonto.plus(monto);
      // Alícuotas que causan IVA con base > 0 deben tener monto > 0 (coherencia mínima).
      if (!ALICUOTAS_SIN_IVA.has(t.alicuotaCodigo) && base !== null && base.gt(0) && monto.lte(0)) {
        add('IMPUESTO_SIN_IVA_EN_GRAVADA', `impuestos[${i}].monto`, `La alícuota ${t.alicuotaCodigo} grava pero su IVA es cero`, 'SNAT/2011/00071');
      }
    }
  });

  // ── Total: presente, > 0 y coherente con Σ(bases)+Σ(IVA) (tolerancia 1 céntimo por redondeo) ──
  const total = aDecimal(doc.total);
  if (total === null || total.lte(0)) {
    add('TOTAL_INVALIDO', 'total', 'El total del documento debe ser mayor que cero', 'SNAT/2011/00071');
    return;
  }
  const esperado = sumaBase.plus(sumaMonto);
  if (total.minus(esperado).abs().gt('0.01')) {
    add(
      'TOTAL_INCOHERENTE',
      'total',
      `El total (${total.toFixed(2)}) no coincide con base+IVA (${esperado.toFixed(2)})`,
      'SNAT/2011/00071',
    );
  }
}

function validarMoneda(doc: DocumentoAEmitir, add: (c: string, ca: string, m: string, n: Norma) => void): void {
  if (vacio(doc.moneda)) {
    add('SIN_MONEDA', 'moneda', 'Falta la moneda del documento', 'SNAT/2011/00071');
    return;
  }
  // Si la factura se expresa en divisas, DEBE indicar el contravalor en Bs y la tasa BCV (00071
  // art. 6.1 / Convenio Cambiario; docs/02 §9). El IVA se entera en Bs.
  if (doc.moneda.trim().toUpperCase() !== 'VES') {
    const rate = aDecimal(doc.rateBcv);
    if (rate === null || rate.lte(0)) {
      add('DIVISA_SIN_TASA_BCV', 'rateBcv', 'Documento en divisa sin tasa BCV congelada', 'SNAT/2011/00071');
    }
    if (aDecimal(doc.totalVes) === null) {
      add('DIVISA_SIN_EQUIVALENTE_BS', 'totalVes', 'Documento en divisa sin el equivalente del total en Bs', 'SNAT/2011/00071');
    }
  }
}
