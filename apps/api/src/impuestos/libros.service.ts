import { Injectable } from '@nestjs/common';
import { type FilaImpuestoLibro, type ResumenLibro, resumirLibro } from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import {
  companies,
  documentTaxes,
  documents,
  purchaseTaxes,
  purchases,
  retentionsIssued,
  retentionsReceived,
} from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { withTenant } from '../tenant/with-tenant';
import { rangoPeriodo } from './periodo';

/** Tipos de documento de venta que entran al Libro de Ventas (Reglamento IVA art. 76). */
const TIPOS_VENTA = ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO'] as const;
/** Estados de un documento que ya causó efectos fiscales (emitido). */
const ESTADOS_EMITIDOS = ['ISSUED', 'APPLIED'] as const;

/**
 * Un renglón del libro: una fila por documento con sus columnas del Reglamento (arts. 72/76). Los
 * montos están en la base fiscal (VES), redondeados a 2 decimales. Las columnas por alícuota se
 * agrupan por código (GENERAL/REDUCIDA/ADICIONAL); las exentas/exoneradas/no sujetas y las
 * exportaciones (0%) van en sus propias columnas.
 */
export interface LibroFila {
  readonly fecha: string;
  readonly tipoDocumento: string;
  /** +1 factura/ND, −1 nota de crédito (signo fiscal del renglón). */
  readonly factor: 1 | -1;
  /** Tipo de operación del Reglamento (arts. 70–78): INTERNA | IMPORTACION | EXPORTACION. */
  readonly tipoOperacion: 'INTERNA' | 'IMPORTACION' | 'EXPORTACION';
  readonly rif: string | null;
  readonly nombre: string | null;
  readonly numero: string | null;
  readonly numeroControl: string | null;
  readonly numeroDocAfectado: string | null;
  /** Nº del comprobante de retención de IVA (en ventas: el del cliente agente; en compras: el nuestro). */
  readonly numeroComprobanteRetencion: string | null;
  readonly baseGeneral: string;
  readonly ivaGeneral: string;
  readonly baseReducida: string;
  readonly ivaReducida: string;
  readonly baseAdicional: string;
  readonly ivaAdicional: string;
  /** Base exenta (por ley). */
  readonly baseExenta: string;
  /** Base exonerada (por decreto). Columna separada del Reglamento. */
  readonly baseExonerada: string;
  readonly baseExportacion: string;
  readonly totalConIva: string;
  /** IVA retenido (en ventas: por el cliente agente; en compras: por nosotros como agente). */
  readonly ivaRetenido: string;
}

/** Libro generado: cabecera de empresa/período, renglones, resumen y advertencias. */
export interface Libro {
  readonly tipo: 'VENTAS' | 'COMPRAS';
  readonly empresa: { readonly rif: string; readonly razonSocial: string };
  readonly periodo: { readonly anio: number; readonly mes: number };
  readonly filas: LibroFila[];
  readonly resumen: ResumenLibro;
  /** Filas crudas (base/IVA por alícuota con signo) que alimentan el resumen y la planilla. */
  readonly filasResumen: FilaImpuestoLibro[];
  /** Advertencias no bloqueantes (p.ej. posible hueco de correlativo en facturas). */
  readonly advertencias: string[];
}

/**
 * Generación del Libro de Compras y del Libro de Ventas (P10, Reglamento de la Ley del IVA arts.
 * 70–78; docs/02 §7.2, docs/06 M7). Los libros se derivan EN VIVO de `document_taxes` /
 * `purchase_taxes` —la única fuente de verdad—, de modo que cuadran por construcción con la
 * declaración de IVA (triple igualdad, docs/05 §7.3: "si el libro no cuadra con la planilla, hay un
 * bug"). Todo bajo RLS. La salida es legible para PDF/Excel y reutilizable por la planilla.
 */
@Injectable()
export class LibrosService {
  constructor(private readonly database: DatabaseService) {}

  /** Libro de Ventas del período (facturas, NC y ND emitidas con fecha fiscal en el mes). */
  async libroVentas(companyId: string, anio: number, mes: number): Promise<Libro> {
    const { desde, hasta } = rangoPeriodo(anio, mes);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const empresa = await cargarEmpresa(tx, companyId);

      const docs = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.companyId, companyId),
            inArray(documents.type, [...TIPOS_VENTA]),
            inArray(documents.status, [...ESTADOS_EMITIDOS]),
            gte(documents.issueFechaFiscal, desde),
            lt(documents.issueFechaFiscal, hasta),
          ),
        )
        .orderBy(asc(documents.issueFechaFiscal), asc(documents.number));

      const taxes = docs.length === 0 ? [] : await tx.select().from(documentTaxes).where(inArray(documentTaxes.documentId, docs.map((d) => d.id)));
      const taxesPorDoc = agrupar(taxes, (t) => t.documentId);

      // IVA retenido por el cliente, conciliado contra la factura (retentions_received tipo IVA).
      const retenciones = docs.length === 0
        ? []
        : await tx
            .select()
            .from(retentionsReceived)
            .where(and(eq(retentionsReceived.tipo, 'IVA'), inArray(retentionsReceived.documentId, docs.map((d) => d.id))));
      const retPorDoc = agrupar(retenciones.filter((r) => r.documentId !== null), (r) => r.documentId as string);

      const filas: LibroFila[] = [];
      const filasResumen: FilaImpuestoLibro[] = [];
      for (const d of docs) {
        const factor: 1 | -1 = d.type === 'NOTA_CREDITO' ? -1 : 1;
        const dtaxes = taxesPorDoc.get(d.id) ?? [];
        const afectado = await numeroDocAfectado(tx, d.affectedDocumentId);
        const retDoc = retPorDoc.get(d.id) ?? [];
        const ivaRetenido = retDoc.reduce((s, r) => s.plus(r.montoVes), new Decimal(0));
        // Exportación se deriva de la alícuota (no hay importación en ventas).
        const tipoOperacion = dtaxes.some((t) => t.alicuotaCodigo === 'EXPORTACION') ? 'EXPORTACION' : 'INTERNA';
        filas.push(
          armarFila({
            fecha: d.issueFechaFiscal,
            tipoDocumento: d.type,
            factor,
            tipoOperacion,
            rif: d.partyRif,
            nombre: d.partyNombre,
            numero: numeroVisible(d.number),
            numeroControl: d.controlNumber,
            numeroDocAfectado: afectado,
            numeroComprobanteRetencion: unirComprobantes(retDoc.map((r) => r.numeroComprobante)),
            taxes: dtaxes,
            ivaRetenido,
          }),
        );
        for (const t of dtaxes) filasResumen.push(aFilaResumen(t, factor));
      }

      return {
        tipo: 'VENTAS',
        empresa: { rif: empresa.rif, razonSocial: empresa.razonSocial },
        periodo: { anio, mes },
        filas,
        resumen: resumirLibro(filasResumen),
        filasResumen,
        advertencias: advertenciasCorrelativo(docs),
      };
    });
  }

  /** Libro de Compras del período (facturas, NC y ND de proveedores con fecha fiscal en el mes). */
  async libroCompras(companyId: string, anio: number, mes: number): Promise<Libro> {
    const { desde, hasta } = rangoPeriodo(anio, mes);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const empresa = await cargarEmpresa(tx, companyId);

      const compras = await tx
        .select()
        .from(purchases)
        .where(
          and(
            eq(purchases.companyId, companyId),
            eq(purchases.status, 'REGISTERED'),
            gte(purchases.fechaFiscal, desde),
            lt(purchases.fechaFiscal, hasta),
          ),
        )
        .orderBy(asc(purchases.fechaFiscal));

      const taxes = compras.length === 0 ? [] : await tx.select().from(purchaseTaxes).where(inArray(purchaseTaxes.purchaseId, compras.map((c) => c.id)));
      const taxesPorCompra = agrupar(taxes, (t) => t.purchaseId);

      // Comprobantes de retención de IVA que NOSOTROS emitimos sobre estas compras (como agente).
      const comprobantes = compras.length === 0
        ? []
        : await tx
            .select()
            .from(retentionsIssued)
            .where(and(eq(retentionsIssued.tipo, 'IVA'), inArray(retentionsIssued.purchaseId, compras.map((c) => c.id))));
      const compPorCompra = agrupar(comprobantes, (r) => r.purchaseId);

      const filas: LibroFila[] = [];
      const filasResumen: FilaImpuestoLibro[] = [];
      for (const c of compras) {
        const factor: 1 | -1 = c.tipoDocumento === 'NOTA_CREDITO' ? -1 : 1;
        const ctaxes = taxesPorCompra.get(c.id) ?? [];
        // En compras el IVA retenido es el que NOSOTROS practicamos como agente (informativo en la compra).
        const ivaRetenido = new Decimal(c.retencionIvaVes ?? '0');
        filas.push(
          armarFila({
            fecha: c.fechaFiscal,
            tipoDocumento: c.tipoDocumento,
            factor,
            tipoOperacion: c.tipoOperacion as LibroFila['tipoOperacion'],
            rif: c.proveedorRif,
            nombre: c.proveedorNombre,
            numero: c.numeroDocumento,
            numeroControl: c.numeroControl,
            numeroDocAfectado: c.numeroDocumentoAfectado,
            numeroComprobanteRetencion: unirComprobantes((compPorCompra.get(c.id) ?? []).map((r) => r.numeroComprobante)),
            taxes: ctaxes,
            ivaRetenido,
          }),
        );
        for (const t of ctaxes) filasResumen.push(aFilaResumen(t, factor));
      }

      return {
        tipo: 'COMPRAS',
        empresa: { rif: empresa.rif, razonSocial: empresa.razonSocial },
        periodo: { anio, mes },
        filas,
        resumen: resumirLibro(filasResumen),
        filasResumen,
        advertencias: [],
      };
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TaxRow {
  alicuotaCodigo: string;
  alicuotaTasa: string;
  baseVes: string;
  montoVes: string;
}

function aFilaResumen(t: TaxRow, factor: 1 | -1): FilaImpuestoLibro {
  return {
    alicuotaCodigo: t.alicuotaCodigo as FilaImpuestoLibro['alicuotaCodigo'],
    alicuotaTasa: t.alicuotaTasa,
    base: t.baseVes,
    monto: t.montoVes,
    factor,
  };
}

interface DatosFila {
  readonly fecha: string;
  readonly tipoDocumento: string;
  readonly factor: 1 | -1;
  readonly tipoOperacion: 'INTERNA' | 'IMPORTACION' | 'EXPORTACION';
  readonly rif: string | null;
  readonly nombre: string | null;
  readonly numero: string | null;
  readonly numeroControl: string | null;
  readonly numeroDocAfectado: string | null;
  readonly numeroComprobanteRetencion: string | null;
  readonly taxes: TaxRow[];
  readonly ivaRetenido: Decimal;
}

function armarFila(d: DatosFila): LibroFila {
  const col = {
    baseGeneral: new Decimal(0),
    ivaGeneral: new Decimal(0),
    baseReducida: new Decimal(0),
    ivaReducida: new Decimal(0),
    baseAdicional: new Decimal(0),
    ivaAdicional: new Decimal(0),
    baseExenta: new Decimal(0),
    baseExonerada: new Decimal(0),
    baseExportacion: new Decimal(0),
  };
  for (const t of d.taxes) {
    const base = new Decimal(t.baseVes);
    const iva = new Decimal(t.montoVes);
    switch (t.alicuotaCodigo) {
      case 'GENERAL':
        col.baseGeneral = col.baseGeneral.plus(base);
        col.ivaGeneral = col.ivaGeneral.plus(iva);
        break;
      case 'REDUCIDA':
        col.baseReducida = col.baseReducida.plus(base);
        col.ivaReducida = col.ivaReducida.plus(iva);
        break;
      case 'ADICIONAL':
        col.baseAdicional = col.baseAdicional.plus(base);
        col.ivaAdicional = col.ivaAdicional.plus(iva);
        break;
      case 'EXPORTACION':
        col.baseExportacion = col.baseExportacion.plus(base);
        break;
      case 'EXONERADO':
        col.baseExonerada = col.baseExonerada.plus(base);
        break;
      default: // EXENTO
        col.baseExenta = col.baseExenta.plus(base);
    }
  }
  const totalBases = col.baseGeneral
    .plus(col.baseReducida)
    .plus(col.baseAdicional)
    .plus(col.baseExenta)
    .plus(col.baseExonerada)
    .plus(col.baseExportacion);
  const totalIva = col.ivaGeneral.plus(col.ivaReducida).plus(col.ivaAdicional);
  return {
    fecha: d.fecha,
    tipoDocumento: d.tipoDocumento,
    factor: d.factor,
    tipoOperacion: d.tipoOperacion,
    rif: d.rif,
    nombre: d.nombre,
    numero: d.numero,
    numeroControl: d.numeroControl,
    numeroDocAfectado: d.numeroDocAfectado,
    numeroComprobanteRetencion: d.numeroComprobanteRetencion,
    baseGeneral: f2(col.baseGeneral),
    ivaGeneral: f2(col.ivaGeneral),
    baseReducida: f2(col.baseReducida),
    ivaReducida: f2(col.ivaReducida),
    baseAdicional: f2(col.baseAdicional),
    ivaAdicional: f2(col.ivaAdicional),
    baseExenta: f2(col.baseExenta),
    baseExonerada: f2(col.baseExonerada),
    baseExportacion: f2(col.baseExportacion),
    totalConIva: f2(totalBases.plus(totalIva)),
    ivaRetenido: f2(d.ivaRetenido),
  };
}

/** Une los números de comprobante de un conjunto de retenciones (varias por documento → coma). */
function unirComprobantes(numeros: ReadonlyArray<string>): string | null {
  const limpios = [...new Set(numeros.filter((n) => n != null && n !== ''))];
  return limpios.length === 0 ? null : limpios.join(', ');
}

function f2(d: Decimal): string {
  return d.toDecimalPlaces(2).toFixed(2);
}

function numeroVisible(n: number | null): string | null {
  return n === null ? null : String(n);
}

function agrupar<T, K>(filas: T[], clave: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const f of filas) {
    const k = clave(f);
    const arr = m.get(k);
    if (arr) arr.push(f);
    else m.set(k, [f]);
  }
  return m;
}

async function cargarEmpresa(tx: DatabaseTx, companyId: string): Promise<typeof companies.$inferSelect> {
  const [row] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (row === undefined) throw new Error(`Empresa ${companyId} no encontrada`);
  return row;
}

async function numeroDocAfectado(tx: DatabaseTx, affectedId: string | null): Promise<string | null> {
  if (affectedId === null) return null;
  const [row] = await tx.select({ number: documents.number }).from(documents).where(eq(documents.id, affectedId)).limit(1);
  return row?.number == null ? null : String(row.number);
}

/**
 * Advertencia (no bloqueante) de posibles huecos de correlativo en las facturas del período (docs/06
 * M7, caso 21). La numeración consecutiva real la garantiza el contador transaccional al emitir; aquí
 * solo se detecta, por serie, si faltan correlativos entre el mínimo y el máximo del mes.
 */
function advertenciasCorrelativo(docs: (typeof documents.$inferSelect)[]): string[] {
  const porSerie = new Map<string, number[]>();
  for (const d of docs) {
    if (d.type !== 'FACTURA' || d.number === null) continue;
    const arr = porSerie.get(d.seriesId);
    if (arr) arr.push(d.number);
    else porSerie.set(d.seriesId, [d.number]);
  }
  const avisos: string[] = [];
  for (const [serie, numeros] of porSerie) {
    const ordenados = [...new Set(numeros)].sort((a, b) => a - b);
    const faltantes: number[] = [];
    for (let n = ordenados[0]!; n < ordenados[ordenados.length - 1]!; n++) {
      if (!ordenados.includes(n)) faltantes.push(n);
    }
    if (faltantes.length > 0) {
      avisos.push(`Serie ${serie}: posibles huecos de correlativo en facturas: ${faltantes.join(', ')}`);
    }
  }
  return avisos;
}
