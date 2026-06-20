import { Decimal } from '@contave/shared';
import type { Libro, LibroFila } from '../libros.service';
import { etiquetaPeriodo } from '../periodo';

/**
 * Export del Libro de Compras/Ventas a Excel (P10, docs/02 §7.2, docs/06 M7). Genera SpreadsheetML
 * 2003 (XML nativo de Excel) sin dependencias adicionales: produce una hoja con columnas reales y
 * tipos numéricos, que Excel/LibreOffice abren directamente. Las notas de crédito se reflejan con
 * signo negativo, de modo que la fila de TOTALES coincide EXACTAMENTE con el resumen del período
 * (mismo invariante que la planilla: triple igualdad).
 */

const COLUMNAS = [
  'Fecha',
  'Tipo',
  'Tipo operación',
  'RIF',
  'Nombre o razón social',
  'Nº documento',
  'Nº control',
  'Nº doc. afectado',
  'Nº comprob. retención',
  'Base 16%',
  'IVA 16%',
  'Base 8%',
  'IVA 8%',
  'Base 31%',
  'IVA 31%',
  'Exento',
  'Exonerado',
  'Exportación (0%)',
  'Total con IVA',
  'IVA retenido',
] as const;

/** Nº de columnas de texto antes de las numéricas (alinea la fila de TOTALES). */
const COLS_TEXTO = 9;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function celdaTexto(v: string | null): string {
  return `<Cell><Data ss:Type="String">${esc(v ?? '')}</Data></Cell>`;
}

function celdaNum(v: string, factor: 1 | -1 = 1): string {
  const n = new Decimal(v).times(factor).toDecimalPlaces(2).toFixed(2);
  return `<Cell><Data ss:Type="Number">${n}</Data></Cell>`;
}

function fila(f: LibroFila): string {
  const s = f.factor;
  return (
    '<Row>' +
    celdaTexto(f.fecha) +
    celdaTexto(f.tipoDocumento) +
    celdaTexto(f.tipoOperacion) +
    celdaTexto(f.rif) +
    celdaTexto(f.nombre) +
    celdaTexto(f.numero) +
    celdaTexto(f.numeroControl) +
    celdaTexto(f.numeroDocAfectado) +
    celdaTexto(f.numeroComprobanteRetencion) +
    celdaNum(f.baseGeneral, s) +
    celdaNum(f.ivaGeneral, s) +
    celdaNum(f.baseReducida, s) +
    celdaNum(f.ivaReducida, s) +
    celdaNum(f.baseAdicional, s) +
    celdaNum(f.ivaAdicional, s) +
    celdaNum(f.baseExenta, s) +
    celdaNum(f.baseExonerada, s) +
    celdaNum(f.baseExportacion, s) +
    celdaNum(f.totalConIva, s) +
    celdaNum(f.ivaRetenido, s) +
    '</Row>'
  );
}

function filaTotales(libro: Libro): string {
  const r = libro.resumen;
  const grupo = (codigo: string): { base: string; monto: string } => {
    const g = r.grupos.find((x) => x.alicuotaCodigo === codigo);
    return g ? { base: g.base, monto: g.monto } : { base: '0', monto: '0' };
  };
  const gen = grupo('GENERAL');
  const red = grupo('REDUCIDA');
  const adi = grupo('ADICIONAL');
  const ivaRetenido = libro.filas.reduce((acc, f) => acc.plus(new Decimal(f.ivaRetenido).times(f.factor)), new Decimal(0)).toFixed(2);
  const textoTotales = celdaTexto('TOTALES') + celdaTexto('').repeat(COLS_TEXTO - 1);
  return (
    '<Row>' +
    textoTotales +
    celdaNum(gen.base) +
    celdaNum(gen.monto) +
    celdaNum(red.base) +
    celdaNum(red.monto) +
    celdaNum(adi.base) +
    celdaNum(adi.monto) +
    celdaNum(r.baseExenta) +
    celdaNum(r.baseExonerada) +
    celdaNum(r.baseExportacion) +
    celdaNum(r.totalConIva) +
    celdaNum(ivaRetenido) +
    '</Row>'
  );
}

export function generarLibroExcel(libro: Libro): { buffer: Buffer; filename: string } {
  const titulo = libro.tipo === 'VENTAS' ? 'Libro de Ventas' : 'Libro de Compras';
  const periodo = etiquetaPeriodo(libro.periodo.anio, libro.periodo.mes);
  const encabezado =
    '<Row>' + COLUMNAS.map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('') + '</Row>';

  const cabeceraEmpresa =
    `<Row><Cell><Data ss:Type="String">${esc(libro.empresa.razonSocial)} — RIF ${esc(libro.empresa.rif)}</Data></Cell></Row>` +
    `<Row><Cell><Data ss:Type="String">${esc(titulo)} — Período ${esc(periodo)}</Data></Cell></Row>` +
    '<Row></Row>';

  const xml =
    '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/></Style></Styles>' +
    `<Worksheet ss:Name="${esc(titulo)}"><Table>` +
    cabeceraEmpresa +
    encabezado +
    libro.filas.map(fila).join('') +
    filaTotales(libro) +
    '</Table></Worksheet></Workbook>';

  return {
    buffer: Buffer.from(xml, 'utf8'),
    filename: `${libro.tipo === 'VENTAS' ? 'libro-ventas' : 'libro-compras'}-${periodo}.xls`,
  };
}
