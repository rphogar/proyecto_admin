/**
 * Modelo de comandos fiscales ABSTRACTO (agnóstico de marca) y el snapshot del documento que se
 * imprime. Es el contrato intermedio entre el documento del SaaS y el protocolo del fabricante: el
 * mapeo (`mapear-documento.ts`) produce `ComandoFiscal[]` y cada driver (HKA, Bematech, …) lo traduce
 * a su juego de comandos. Mantener este modo abstracto evita acoplar la lógica de negocio a un
 * fabricante. Montos como Decimal-string (regla 1): el redondeo a 2 decimales lo hace el driver al
 * formar la trama, nunca aquí.
 */

/** Tipo de documento fiscal soportado por la máquina fiscal. */
export type TipoDocumentoFiscal = 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';

/**
 * Código de alícuota del documento (mismo dominio que `@contave/fiscal-engine`). El driver lo traduce
 * a la "ranura" de impuesto configurada en el hardware (TODO-TRIBUTARISTA: el mapeo exacto código→
 * ranura depende de la parametrización fiscal cargada en cada máquina).
 */
export type CodigoAlicuotaFiscal = 'GENERAL' | 'REDUCIDA' | 'ADICIONAL' | 'EXENTO' | 'EXONERADO' | 'EXPORTACION';

/** Adquirente del documento: consumidor final (anónimo) o sujeto identificado por RIF. */
export type AdquirenteImpresion =
  | { readonly tipo: 'CONSUMIDOR_FINAL' }
  | { readonly tipo: 'IDENTIFICADO'; readonly rif: string; readonly nombre: string };

/** Línea de venta del documento, en la moneda fiscal de la máquina (Bs). */
export interface LineaImpresion {
  readonly descripcion: string;
  /** Cantidad (Decimal-string). */
  readonly cantidad: string;
  /** Precio unitario en la moneda fiscal, Decimal-string. */
  readonly precioUnitario: string;
  /** Descuento de la línea (Decimal-string); ausente o '0' = sin descuento. */
  readonly descuento?: string | null;
  readonly alicuotaCodigo: CodigoAlicuotaFiscal;
  /** Tasa de IVA en puntos porcentuales: '16', '8', '0'. */
  readonly alicuotaTasa: string;
}

/** Medio de pago declarado al cerrar el documento fiscal. */
export interface MedioPagoImpresion {
  /** Tipo de pago (EFECTIVO | TARJETA | DIVISA | TRANSFERENCIA | …). */
  readonly tipo: string;
  /** Glosa libre opcional. */
  readonly descripcion?: string | null;
  /** Monto en la moneda fiscal (Decimal-string). */
  readonly monto: string;
}

/** Referencia a la factura fiscal afectada por una NC/ND (la asignó la memoria fiscal en su día). */
export interface DocumentoAfectadoImpresion {
  readonly numeroFiscal: string;
  readonly controlFiscal: string;
  /** Fecha fiscal `YYYY-MM-DD`. */
  readonly fecha: string;
}

/** Snapshot del documento a imprimir (entrada del mapeo). Sin IO, 100% serializable. */
export interface DocumentoParaImpresion {
  readonly tipo: TipoDocumentoFiscal;
  readonly adquirente: AdquirenteImpresion;
  readonly lineas: ReadonlyArray<LineaImpresion>;
  readonly mediosPago: ReadonlyArray<MedioPagoImpresion>;
  /** Obligatorio para NC/ND (referencia a la factura afectada). */
  readonly documentoAfectado?: DocumentoAfectadoImpresion | null;
}

/**
 * Comando fiscal abstracto. La secuencia canónica de un documento es:
 * `ABRIR_DOC` → (`LINEA` [→ `DESCUENTO_LINEA`])* → `SUBTOTAL` → `MEDIO_PAGO`* → `CERRAR_DOC`.
 */
export type ComandoFiscal =
  | {
      readonly clase: 'ABRIR_DOC';
      readonly tipoDoc: TipoDocumentoFiscal;
      readonly adquirente: AdquirenteImpresion;
      readonly afectado?: DocumentoAfectadoImpresion | null;
    }
  | {
      readonly clase: 'LINEA';
      readonly descripcion: string;
      readonly cantidad: string;
      readonly precioUnitario: string;
      readonly alicuotaCodigo: CodigoAlicuotaFiscal;
      readonly alicuotaTasa: string;
    }
  | { readonly clase: 'DESCUENTO_LINEA'; readonly monto: string }
  | { readonly clase: 'SUBTOTAL' }
  | { readonly clase: 'MEDIO_PAGO'; readonly tipo: string; readonly descripcion: string; readonly monto: string }
  | { readonly clase: 'CERRAR_DOC' }
  | { readonly clase: 'TEXTO_NO_FISCAL'; readonly texto: string };
