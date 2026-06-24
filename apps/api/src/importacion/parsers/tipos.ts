import type { CsvParseado } from './csv';

/**
 * Tipos de los parsers de migración (P31, docs/05 §5 — parsers VERSIONADOS, igual que los de banca).
 * Cada sistema de origen (Galac, Profit, Excel genérico) exporta sus maestros con columnas propias que
 * CAMBIAN con el tiempo → un parser por (entidad, sistema, versión) que detecta su firma de cabeceras y
 * mapea a un **registro crudo canónico** (todo string). La coerción/validación, la deduplicación y la
 * reconversión monetaria (caso 46) viven en `mapeo.ts`; el parser es PURO (CSV → filas canónicas).
 */

/** Entidades que se pueden migrar de otro sistema (instrucción P31). */
export type EntidadImport = 'TERCEROS' | 'ITEMS' | 'CXC' | 'CXP' | 'SALDOS';

/** Una fila canónica cruda con su número de fila físico (1 = primera fila de datos) para el reporte. */
export interface FilaCruda<T> {
  readonly fila: number;
  readonly datos: T;
}

export interface ResultadoParseo<T> {
  readonly entidad: EntidadImport;
  readonly sistema: string;
  readonly version: string;
  readonly filas: Array<FilaCruda<T>>;
}

/** Contrato de un parser de migración (mismo espíritu que `ParserBanco`). */
export interface ParserImportacion<T> {
  readonly entidad: EntidadImport;
  /** Sistema de origen: GALAC | PROFIT | GENERICO (plantilla descargable). */
  readonly sistema: string;
  readonly version: string;
  /** True si las cabeceras (y el nombre de archivo) calzan con la firma de este parser. */
  detecta(cabeceras: string[], nombreArchivo: string): boolean;
  /** Mapea el CSV ya parseado a filas canónicas crudas. */
  parse(csv: CsvParseado): ResultadoParseo<T>;
}

// --- Registros canónicos crudos (todo string; '' = ausente) ----------------------------------------

/** Tercero (cliente/proveedor) crudo — dedup por RIF en `mapeo.ts` (caso 45). */
export interface TerceroCrudo {
  readonly tipo: string;
  readonly rif: string;
  readonly razonSocial: string;
  readonly condicionIva: string;
  readonly esAgenteRetencionIva: string;
  readonly pctRetencionIva: string;
  readonly esAgenteRetencionIslr: string;
  readonly direccionFiscal: string;
  readonly email: string;
  readonly telefono: string;
  readonly diasCredito: string;
}

/** Ítem (producto/servicio) crudo — con costo y alícuota (instrucción P31); dedup por SKU. */
export interface ItemCrudo {
  readonly sku: string;
  readonly descripcion: string;
  readonly tipo: string;
  readonly alicuotaIva: string;
  readonly unidad: string;
  readonly costo: string;
  readonly precio: string;
  readonly moneda: string;
}

/** CxC/CxP abierta cruda — por documento y tercero (instrucción P31). */
export interface CuentaAbiertaCruda {
  readonly rif: string;
  readonly documento: string;
  readonly fecha: string;
  readonly vencimiento: string;
  readonly moneda: string;
  readonly monto: string;
  readonly rateBcv: string;
  /** Cuenta contable explícita (opcional; si falta, el mapeo usa la por defecto según moneda). */
  readonly cuenta: string;
}

/** Saldo inicial crudo (caja, bancos, inventario, otros) — con costo y fecha de origen (caso 45). */
export interface SaldoCrudo {
  readonly cuenta: string;
  readonly naturaleza: string;
  readonly descripcion: string;
  readonly moneda: string;
  readonly monto: string;
  readonly rateBcv: string;
  // Inventario:
  readonly sku: string;
  readonly cantidad: string;
  readonly fechaOrigen: string;
}
