import { createElement as h } from 'react';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Decimal } from '@contave/shared';
import type { Libro, LibroFila } from '../libros.service';
import { etiquetaPeriodo } from '../periodo';

/**
 * Export del Libro de Compras/Ventas a PDF legal imprimible (P10, docs/02 §7.2, docs/06 M7). Formato
 * apaisado con las columnas del Reglamento (arts. 72/76): fecha, datos del tercero, números de
 * documento/control/afectado, base e IVA por alícuota, exentas, exportación, total e IVA retenido,
 * con fila de TOTALES del período (que coincide con el resumen y la planilla: triple igualdad).
 * Server-side con @react-pdf/renderer vía createElement (sin JSX), igual que la factura.
 */

const S = StyleSheet.create({
  page: { padding: 18, fontSize: 6.5, fontFamily: 'Helvetica', color: '#111' },
  titulo: { fontSize: 11, fontWeight: 'bold' },
  sub: { fontSize: 8, marginBottom: 6 },
  cab: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#333', paddingVertical: 2, fontWeight: 'bold', backgroundColor: '#eee' },
  fila: { flexDirection: 'row', borderBottomWidth: 0.25, borderColor: '#ccc', paddingVertical: 1 },
  tot: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#333', paddingVertical: 2, fontWeight: 'bold' },
  txt: { paddingHorizontal: 1 },
  num: { paddingHorizontal: 1, textAlign: 'right' },
  pie: { position: 'absolute', bottom: 10, left: 18, right: 18, fontSize: 6, color: '#666', textAlign: 'center' },
});

// Anchos relativos por columna (suman ~100).
const W = {
  fecha: 5,
  tipo: 4,
  tipoOp: 5,
  rif: 7,
  nombre: 9,
  numero: 5,
  control: 5,
  afectado: 4,
  comprobRet: 6,
  baseG: 6,
  ivaG: 5,
  baseR: 5,
  ivaR: 4,
  baseA: 5,
  ivaA: 4,
  exento: 4,
  exonerado: 4,
  export: 4,
  total: 5,
  ret: 4,
};

function fmt(v: string, factor: 1 | -1 = 1): string {
  const n = new Decimal(v).times(factor).toDecimalPlaces(2);
  if (n.isZero()) return '—';
  return n.toNumber().toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function celdaTxt(key: string, w: number, v: string | null): ReturnType<typeof h> {
  return h(Text, { key, style: { ...S.txt, width: `${w}%` } }, v ?? '');
}
function celdaNum(key: string, w: number, v: string): ReturnType<typeof h> {
  return h(Text, { key, style: { ...S.num, width: `${w}%` } }, v);
}

function encabezado(): ReturnType<typeof h> {
  return h(View, { key: 'cab', style: S.cab }, [
    celdaTxt('fecha', W.fecha, 'Fecha'),
    celdaTxt('tipo', W.tipo, 'Tipo'),
    celdaTxt('tipoOp', W.tipoOp, 'Operación'),
    celdaTxt('rif', W.rif, 'RIF'),
    celdaTxt('nombre', W.nombre, 'Nombre/Razón social'),
    celdaTxt('numero', W.numero, 'Nº doc'),
    celdaTxt('control', W.control, 'Nº control'),
    celdaTxt('afectado', W.afectado, 'Afect.'),
    celdaTxt('comprobRet', W.comprobRet, 'Comp. ret.'),
    celdaNum('baseG', W.baseG, 'Base 16%'),
    celdaNum('ivaG', W.ivaG, 'IVA 16%'),
    celdaNum('baseR', W.baseR, 'Base 8%'),
    celdaNum('ivaR', W.ivaR, 'IVA 8%'),
    celdaNum('baseA', W.baseA, 'Base 31%'),
    celdaNum('ivaA', W.ivaA, 'IVA 31%'),
    celdaNum('exento', W.exento, 'Exento'),
    celdaNum('exonerado', W.exonerado, 'Exoner.'),
    celdaNum('export', W.export, 'Export.'),
    celdaNum('total', W.total, 'Total'),
    celdaNum('ret', W.ret, 'Ret. IVA'),
  ]);
}

function filaPdf(f: LibroFila, i: number): ReturnType<typeof h> {
  const s = f.factor;
  return h(View, { key: `f${i}`, style: S.fila }, [
    celdaTxt('fecha', W.fecha, f.fecha),
    celdaTxt('tipo', W.tipo, f.tipoDocumento.replace('NOTA_', 'N')),
    celdaTxt('tipoOp', W.tipoOp, abreviarOperacion(f.tipoOperacion)),
    celdaTxt('rif', W.rif, f.rif),
    celdaTxt('nombre', W.nombre, f.nombre),
    celdaTxt('numero', W.numero, f.numero),
    celdaTxt('control', W.control, f.numeroControl),
    celdaTxt('afectado', W.afectado, f.numeroDocAfectado),
    celdaTxt('comprobRet', W.comprobRet, f.numeroComprobanteRetencion),
    celdaNum('baseG', W.baseG, fmt(f.baseGeneral, s)),
    celdaNum('ivaG', W.ivaG, fmt(f.ivaGeneral, s)),
    celdaNum('baseR', W.baseR, fmt(f.baseReducida, s)),
    celdaNum('ivaR', W.ivaR, fmt(f.ivaReducida, s)),
    celdaNum('baseA', W.baseA, fmt(f.baseAdicional, s)),
    celdaNum('ivaA', W.ivaA, fmt(f.ivaAdicional, s)),
    celdaNum('exento', W.exento, fmt(f.baseExenta, s)),
    celdaNum('exonerado', W.exonerado, fmt(f.baseExonerada, s)),
    celdaNum('export', W.export, fmt(f.baseExportacion, s)),
    celdaNum('total', W.total, fmt(f.totalConIva, s)),
    celdaNum('ret', W.ret, fmt(f.ivaRetenido, s)),
  ]);
}

function filaTotales(libro: Libro): ReturnType<typeof h> {
  const r = libro.resumen;
  const g = (codigo: string) => r.grupos.find((x) => x.alicuotaCodigo === codigo);
  const gen = g('GENERAL');
  const red = g('REDUCIDA');
  const adi = g('ADICIONAL');
  const ret = libro.filas.reduce((acc, f) => acc.plus(new Decimal(f.ivaRetenido).times(f.factor)), new Decimal(0)).toFixed(2);
  return h(View, { key: 'tot', style: S.tot }, [
    celdaTxt('lbl', W.fecha + W.tipo + W.tipoOp + W.rif, 'TOTALES DEL PERÍODO'),
    celdaTxt('gap', W.nombre + W.numero + W.control + W.afectado + W.comprobRet, ''),
    celdaNum('baseG', W.baseG, fmt(gen?.base ?? '0')),
    celdaNum('ivaG', W.ivaG, fmt(gen?.monto ?? '0')),
    celdaNum('baseR', W.baseR, fmt(red?.base ?? '0')),
    celdaNum('ivaR', W.ivaR, fmt(red?.monto ?? '0')),
    celdaNum('baseA', W.baseA, fmt(adi?.base ?? '0')),
    celdaNum('ivaA', W.ivaA, fmt(adi?.monto ?? '0')),
    celdaNum('exento', W.exento, fmt(r.baseExenta)),
    celdaNum('exonerado', W.exonerado, fmt(r.baseExonerada)),
    celdaNum('export', W.export, fmt(r.baseExportacion)),
    celdaNum('total', W.total, fmt(r.totalConIva)),
    celdaNum('ret', W.ret, fmt(ret)),
  ]);
}

/** Abrevia el tipo de operación para la columna estrecha del PDF. */
function abreviarOperacion(t: LibroFila['tipoOperacion']): string {
  if (t === 'IMPORTACION') return 'Import.';
  if (t === 'EXPORTACION') return 'Export.';
  return 'Interna';
}

export async function generarLibroPdf(libro: Libro): Promise<{ buffer: Buffer; filename: string }> {
  const titulo = libro.tipo === 'VENTAS' ? 'LIBRO DE VENTAS' : 'LIBRO DE COMPRAS';
  const periodo = etiquetaPeriodo(libro.periodo.anio, libro.periodo.mes);

  const doc = h(Document, {}, h(Page, { size: 'A4', orientation: 'landscape', style: S.page }, [
    h(Text, { key: 't', style: S.titulo }, `${libro.empresa.razonSocial} — RIF ${libro.empresa.rif}`),
    h(Text, { key: 's', style: S.sub }, `${titulo} · Reglamento de la Ley del IVA (arts. 70–78) · Período ${periodo}`),
    encabezado(),
    h(View, { key: 'filas' }, libro.filas.map((f, i) => filaPdf(f, i))),
    filaTotales(libro),
    h(Text, { key: 'pie', style: S.pie, fixed: true }, 'Generado por ContaVE. Libro especial de IVA — conservar 10 años (COT).'),
  ]));

  const buffer = await renderToBuffer(doc);
  return { buffer, filename: `${libro.tipo === 'VENTAS' ? 'libro-ventas' : 'libro-compras'}-${periodo}.pdf` };
}
