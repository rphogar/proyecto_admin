import { Decimal, validarRif } from '@contave/shared';
import {
  type EscalaMonetaria,
  parsearBooleano,
  parsearFecha,
  parsearMonto,
  reescalarVes,
} from './parsers/normalizar';
import type {
  CuentaAbiertaCruda,
  FilaCruda,
  ItemCrudo,
  SaldoCrudo,
  TerceroCrudo,
} from './parsers/tipos';

/**
 * Coerción + validación + deduplicación PURA de las filas crudas de migración (P31). Produce el
 * **reporte de dry-run** (caso 45/46): filas válidas listas para importar, errores por fila con motivo,
 * y conteo de duplicados (en el archivo y contra lo ya existente). Aquí se aplica la **reconversión
 * monetaria** (caso 46): los montos en VES se reescalan a la moneda vigente. Sin IO: el servicio le pasa
 * los conjuntos de claves ya existentes (RIF/SKU) y persiste solo las filas válidas en el commit.
 */

export interface ErrorFila {
  readonly fila: number;
  readonly campo?: string;
  readonly mensaje: string;
}

export interface ReporteDryRun<T> {
  readonly total: number;
  /** Filas válidas y NO duplicadas, listas para importar. */
  readonly validas: Array<FilaCruda<T>>;
  readonly errores: ErrorFila[];
  /** Filas válidas descartadas por repetirse dentro del mismo archivo. */
  readonly duplicadasEnArchivo: number;
  /** Filas válidas descartadas por existir ya en el sistema (dedup contra la cartera actual). */
  readonly duplicadasExistentes: number;
  /** = validas.length (lo que se insertaría al confirmar). */
  readonly aImportar: number;
}

export interface OpcionesMapeo {
  /** Escala monetaria de origen para reconversión (caso 46); ausente = escala vigente. */
  readonly escala?: EscalaMonetaria | undefined;
  /** Claves ya existentes en el sistema (RIF normalizado / SKU) para deduplicar. */
  readonly existentes?: ReadonlySet<string> | undefined;
}

/** Reporte vacío (entidad no incluida en una migración). */
export function reporteVacio<T>(): ReporteDryRun<T> {
  return { total: 0, validas: [], errores: [], duplicadasEnArchivo: 0, duplicadasExistentes: 0, aImportar: 0 };
}

// --- Tipos validados (canónicos del dominio) -------------------------------------------------------

export interface TerceroValidado {
  readonly tipo: 'cliente' | 'proveedor' | 'ambos';
  readonly rif: string;
  readonly rifValido: boolean;
  readonly razonSocial: string;
  readonly condicionIva: 'ordinario' | 'formal' | 'especial' | 'no_contribuyente';
  readonly esAgenteRetencionIva: boolean;
  readonly pctRetencionIva: '75' | '100' | null;
  readonly esAgenteRetencionIslr: boolean;
  readonly direccionFiscal: string | null;
  readonly email: string | null;
  readonly telefono: string | null;
  readonly diasCredito: number;
}

export interface ItemValidado {
  readonly sku: string;
  readonly descripcion: string;
  readonly tipo: 'producto' | 'servicio';
  readonly alicuotaIva: 'GENERAL' | 'REDUCIDA' | 'ADICIONAL' | 'EXENTO' | 'EXONERADO' | 'EXPORTACION';
  readonly unidad: string;
  readonly costo: string | null;
  readonly precio: string | null;
  readonly moneda: string;
}

export interface CuentaAbiertaValidada {
  readonly rif: string;
  readonly documento: string;
  readonly fecha: string | null;
  readonly vencimiento: string | null;
  readonly moneda: string;
  readonly monto: string;
  readonly rateBcv: string | null;
  readonly cuenta: string | null;
}

export interface SaldoValidado {
  readonly cuenta: string;
  readonly naturaleza: 'ACTIVO' | 'PASIVO';
  readonly descripcion: string | null;
  readonly moneda: string;
  readonly monto: string;
  readonly rateBcv: string | null;
  readonly sku: string | null;
  readonly cantidad: string | null;
  readonly fechaOrigen: string | null;
}

// --- Helpers de normalización de enums -------------------------------------------------------------

function normalizarTipoTercero(s: string): 'cliente' | 'proveedor' | 'ambos' | null {
  const v = s.trim().toLowerCase();
  if (v === '') return 'cliente';
  if (['cliente', 'c', 'clientes'].includes(v)) return 'cliente';
  if (['proveedor', 'p', 'proveedores'].includes(v)) return 'proveedor';
  if (['ambos', 'cliente/proveedor', 'cliente_proveedor', 'ambas', 'mixto'].includes(v)) return 'ambos';
  return null;
}

function normalizarCondicion(s: string): TerceroValidado['condicionIva'] | null {
  const v = s.trim().toLowerCase();
  if (v === '') return 'ordinario';
  if (v.includes('especial')) return 'especial';
  if (v.includes('formal')) return 'formal';
  if (v.includes('ordinario')) return 'ordinario';
  if (['no', 'no_contribuyente', 'consumidor', 'consumidor_final', 'no contribuyente', 'final'].includes(v)) {
    return 'no_contribuyente';
  }
  return null;
}

function normalizarTipoItem(s: string): 'producto' | 'servicio' | null {
  const v = s.trim().toLowerCase();
  if (v === '') return 'producto';
  if (v.startsWith('prod') || v === 'p' || v === 'bien') return 'producto';
  if (v.startsWith('serv') || v === 's') return 'servicio';
  return null;
}

const ALICUOTAS: Record<string, ItemValidado['alicuotaIva']> = {
  general: 'GENERAL',
  '16': 'GENERAL',
  '16%': 'GENERAL',
  reducida: 'REDUCIDA',
  '8': 'REDUCIDA',
  '8%': 'REDUCIDA',
  adicional: 'ADICIONAL',
  suntuario: 'ADICIONAL',
  '31': 'ADICIONAL',
  exento: 'EXENTO',
  exenta: 'EXENTO',
  exonerado: 'EXONERADO',
  exonerada: 'EXONERADO',
  exportacion: 'EXPORTACION',
  '0': 'EXPORTACION',
  '0%': 'EXPORTACION',
};

function normalizarAlicuota(s: string): ItemValidado['alicuotaIva'] | null {
  const v = s.trim().toLowerCase();
  if (v === '') return 'GENERAL';
  return ALICUOTAS[v] ?? null;
}

function normalizarNaturaleza(s: string, cuenta: string): 'ACTIVO' | 'PASIVO' | null {
  const v = s.trim().toLowerCase();
  if (['activo', 'a', 'd', 'debe', 'deudor'].includes(v)) return 'ACTIVO';
  if (['pasivo', 'p', 'h', 'haber', 'acreedor'].includes(v)) return 'PASIVO';
  if (v === '') {
    // Sin naturaleza explícita: se infiere del primer dígito de la cuenta (1=activo, 2=pasivo).
    if (cuenta.startsWith('1')) return 'ACTIVO';
    if (cuenta.startsWith('2')) return 'PASIVO';
  }
  return null;
}

function limpio(s: string): string | null {
  const v = s.trim();
  return v === '' ? null : v;
}

/** Monto positivo (tras reconversión si es VES). Devuelve string o lanza el motivo de error. */
function montoCanonico(crudo: string, moneda: string, escala: EscalaMonetaria | undefined): string {
  const parseado = parsearMonto(crudo);
  if (parseado === null) throw new Error(`monto inválido: "${crudo}"`);
  let d = new Decimal(parseado);
  if (moneda.toUpperCase() === 'VES') d = reescalarVes(d, escala);
  if (!d.isFinite() || d.lte(0)) throw new Error(`el monto debe ser > 0: "${crudo}"`);
  return d.toFixed();
}

// --- Deduplicación genérica ------------------------------------------------------------------------

interface SalidaDedup<T> {
  readonly validas: Array<FilaCruda<T>>;
  readonly duplicadasEnArchivo: number;
  readonly duplicadasExistentes: number;
}

function deduplicar<T>(
  filas: Array<FilaCruda<T>>,
  clave: (datos: T) => string,
  existentes: ReadonlySet<string>,
): SalidaDedup<T> {
  const vistas = new Set<string>();
  const validas: Array<FilaCruda<T>> = [];
  let dupArchivo = 0;
  let dupExistentes = 0;
  for (const f of filas) {
    const k = clave(f.datos);
    if (vistas.has(k)) {
      dupArchivo += 1;
      continue;
    }
    vistas.add(k);
    if (existentes.has(k)) {
      dupExistentes += 1;
      continue;
    }
    validas.push(f);
  }
  return { validas, duplicadasEnArchivo: dupArchivo, duplicadasExistentes: dupExistentes };
}

// --- Mapeos por entidad ----------------------------------------------------------------------------

export function mapearTerceros(filas: Array<FilaCruda<TerceroCrudo>>, opts: OpcionesMapeo = {}): ReporteDryRun<TerceroValidado> {
  const errores: ErrorFila[] = [];
  const validados: Array<FilaCruda<TerceroValidado>> = [];

  for (const f of filas) {
    const d = f.datos;
    const res = validarRif(d.rif);
    const rifNorm = res.valido ? (res.normalizado as string) : d.rif.trim().toUpperCase();
    if (rifNorm === '') {
      errores.push({ fila: f.fila, campo: 'rif', mensaje: 'RIF vacío' });
      continue;
    }
    if (d.razonSocial.trim() === '') {
      errores.push({ fila: f.fila, campo: 'razonSocial', mensaje: 'razón social vacía' });
      continue;
    }
    const tipo = normalizarTipoTercero(d.tipo);
    if (tipo === null) {
      errores.push({ fila: f.fila, campo: 'tipo', mensaje: `tipo inválido: "${d.tipo}"` });
      continue;
    }
    const condicion = normalizarCondicion(d.condicionIva);
    if (condicion === null) {
      errores.push({ fila: f.fila, campo: 'condicionIva', mensaje: `condición IVA inválida: "${d.condicionIva}"` });
      continue;
    }
    const esAgenteIva = parsearBooleano(d.esAgenteRetencionIva) ?? false;
    let pct: '75' | '100' | null = null;
    if (esAgenteIva) {
      const p = d.pctRetencionIva.trim();
      pct = p === '100' ? '100' : '75'; // default conservador 75% si no se especifica (docs/02 §3.3)
    }
    const dias = d.diasCredito.trim() === '' ? 0 : Number(d.diasCredito);
    if (!Number.isInteger(dias) || dias < 0) {
      errores.push({ fila: f.fila, campo: 'diasCredito', mensaje: `días de crédito inválidos: "${d.diasCredito}"` });
      continue;
    }
    validados.push({
      fila: f.fila,
      datos: {
        tipo,
        rif: rifNorm,
        rifValido: res.valido,
        razonSocial: d.razonSocial.trim(),
        condicionIva: condicion,
        esAgenteRetencionIva: esAgenteIva,
        pctRetencionIva: pct,
        esAgenteRetencionIslr: parsearBooleano(d.esAgenteRetencionIslr) ?? false,
        direccionFiscal: limpio(d.direccionFiscal),
        email: limpio(d.email),
        telefono: limpio(d.telefono),
        diasCredito: dias,
      },
    });
  }

  const dedup = deduplicar(validados, (t) => t.rif, opts.existentes ?? new Set());
  return reporte(filas.length, dedup, errores);
}

export function mapearItems(filas: Array<FilaCruda<ItemCrudo>>, opts: OpcionesMapeo = {}): ReporteDryRun<ItemValidado> {
  const errores: ErrorFila[] = [];
  const validados: Array<FilaCruda<ItemValidado>> = [];

  for (const f of filas) {
    const d = f.datos;
    const sku = d.sku.trim();
    if (sku === '') {
      errores.push({ fila: f.fila, campo: 'sku', mensaje: 'SKU vacío' });
      continue;
    }
    if (d.descripcion.trim() === '') {
      errores.push({ fila: f.fila, campo: 'descripcion', mensaje: 'descripción vacía' });
      continue;
    }
    const tipo = normalizarTipoItem(d.tipo);
    if (tipo === null) {
      errores.push({ fila: f.fila, campo: 'tipo', mensaje: `tipo inválido: "${d.tipo}"` });
      continue;
    }
    const alicuota = normalizarAlicuota(d.alicuotaIva);
    if (alicuota === null) {
      errores.push({ fila: f.fila, campo: 'alicuotaIva', mensaje: `alícuota inválida: "${d.alicuotaIva}"` });
      continue;
    }
    const moneda = (d.moneda.trim() || 'VES').toUpperCase();
    let costo: string | null = null;
    let precio: string | null = null;
    try {
      if (d.costo.trim() !== '') costo = montoCanonico(d.costo, moneda, opts.escala);
      if (d.precio.trim() !== '') precio = montoCanonico(d.precio, moneda, opts.escala);
    } catch (e) {
      errores.push({ fila: f.fila, campo: 'costo/precio', mensaje: (e as Error).message });
      continue;
    }
    validados.push({
      fila: f.fila,
      datos: {
        sku,
        descripcion: d.descripcion.trim(),
        tipo,
        alicuotaIva: alicuota,
        unidad: (d.unidad.trim() || 'UND').toUpperCase(),
        costo,
        precio,
        moneda,
      },
    });
  }

  const dedup = deduplicar(validados, (i) => i.sku, opts.existentes ?? new Set());
  return reporte(filas.length, dedup, errores);
}

export function mapearCuentasAbiertas(
  filas: Array<FilaCruda<CuentaAbiertaCruda>>,
  opts: OpcionesMapeo = {},
): ReporteDryRun<CuentaAbiertaValidada> {
  const errores: ErrorFila[] = [];
  const validados: Array<FilaCruda<CuentaAbiertaValidada>> = [];

  for (const f of filas) {
    const d = f.datos;
    const res = validarRif(d.rif);
    const rifNorm = res.valido ? (res.normalizado as string) : d.rif.trim().toUpperCase();
    if (rifNorm === '') {
      errores.push({ fila: f.fila, campo: 'rif', mensaje: 'RIF del tercero vacío' });
      continue;
    }
    const moneda = (d.moneda.trim() || 'VES').toUpperCase();
    let monto: string;
    try {
      monto = montoCanonico(d.monto, moneda, opts.escala);
    } catch (e) {
      errores.push({ fila: f.fila, campo: 'monto', mensaje: (e as Error).message });
      continue;
    }
    const rateBcv = d.rateBcv.trim() === '' ? null : parsearMonto(d.rateBcv);
    if (moneda !== 'VES' && rateBcv === null) {
      errores.push({ fila: f.fila, campo: 'rateBcv', mensaje: `falta la tasa BCV para la moneda ${moneda}` });
      continue;
    }
    validados.push({
      fila: f.fila,
      datos: {
        rif: rifNorm,
        documento: d.documento.trim(),
        fecha: parsearFecha(d.fecha),
        vencimiento: parsearFecha(d.vencimiento),
        moneda,
        monto,
        rateBcv,
        cuenta: limpio(d.cuenta),
      },
    });
  }

  // No se deduplica CxC/CxP: un mismo tercero tiene varios documentos abiertos (la clave es el documento).
  const dedup: SalidaDedup<CuentaAbiertaValidada> = {
    validas: validados,
    duplicadasEnArchivo: 0,
    duplicadasExistentes: 0,
  };
  return reporte(filas.length, dedup, errores);
}

export function mapearSaldos(filas: Array<FilaCruda<SaldoCrudo>>, opts: OpcionesMapeo = {}): ReporteDryRun<SaldoValidado> {
  const errores: ErrorFila[] = [];
  const validados: Array<FilaCruda<SaldoValidado>> = [];

  for (const f of filas) {
    const d = f.datos;
    const cuenta = d.cuenta.trim();
    if (cuenta === '') {
      errores.push({ fila: f.fila, campo: 'cuenta', mensaje: 'cuenta contable vacía' });
      continue;
    }
    const naturaleza = normalizarNaturaleza(d.naturaleza, cuenta);
    if (naturaleza === null) {
      errores.push({ fila: f.fila, campo: 'naturaleza', mensaje: `naturaleza inválida: "${d.naturaleza}"` });
      continue;
    }
    const moneda = (d.moneda.trim() || 'VES').toUpperCase();
    let monto: string;
    try {
      monto = montoCanonico(d.monto, moneda, opts.escala);
    } catch (e) {
      errores.push({ fila: f.fila, campo: 'monto', mensaje: (e as Error).message });
      continue;
    }
    const rateBcv = d.rateBcv.trim() === '' ? null : parsearMonto(d.rateBcv);
    if (moneda !== 'VES' && rateBcv === null) {
      errores.push({ fila: f.fila, campo: 'rateBcv', mensaje: `falta la tasa BCV para la moneda ${moneda}` });
      continue;
    }
    const sku = limpio(d.sku);
    let cantidad: string | null = null;
    if (sku !== null) {
      const c = parsearMonto(d.cantidad);
      if (c === null || new Decimal(c).lte(0)) {
        errores.push({ fila: f.fila, campo: 'cantidad', mensaje: 'el inventario requiere cantidad > 0' });
        continue;
      }
      cantidad = new Decimal(c).toFixed();
    }
    validados.push({
      fila: f.fila,
      datos: {
        cuenta,
        naturaleza,
        descripcion: limpio(d.descripcion),
        moneda,
        monto,
        rateBcv,
        sku,
        cantidad,
        fechaOrigen: parsearFecha(d.fechaOrigen),
      },
    });
  }

  const dedup: SalidaDedup<SaldoValidado> = { validas: validados, duplicadasEnArchivo: 0, duplicadasExistentes: 0 };
  return reporte(filas.length, dedup, errores);
}

function reporte<T>(total: number, dedup: SalidaDedup<T>, errores: ErrorFila[]): ReporteDryRun<T> {
  return {
    total,
    validas: dedup.validas,
    errores,
    duplicadasEnArchivo: dedup.duplicadasEnArchivo,
    duplicadasExistentes: dedup.duplicadasExistentes,
    aImportar: dedup.validas.length,
  };
}
