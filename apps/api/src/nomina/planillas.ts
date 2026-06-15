/**
 * Generadores de archivos de planillas parafiscales (P15, docs/04 §3). Formatos representativos sin
 * dependencias externas: TXT delimitado para TIUNA (IVSS/RPE) y FAOV (BANAVIH), y SpreadsheetML 2003
 * para INCES (mismo patrón que el export de libros de IVA).
 *
 * TODO-TRIBUTARISTA: ajustar los layouts EXACTOS de los portales TIUNA, FAOV (BANAVIH) e INCES
 * vigentes (orden de campos, anchos, separadores) con la normativa de cada ente.
 */

export interface FilaTrabajadorPlanilla {
  readonly cedula: string;
  readonly nombre: string;
  readonly base: string;
  readonly trabajador: string;
  readonly patrono: string;
}

export interface ArchivoPlanilla {
  readonly filename: string;
  readonly contentType: string;
  readonly contenido: string;
}

function escTxt(s: string): string {
  return s.replace(/[\t\r\n;]/g, ' ').trim();
}

/** TIUNA (IVSS/RPE): TXT con `cédula;nombre;base;cuota_trabajador;aporte_patrono` por línea. */
export function generarTiunaTxt(
  regimen: 'IVSS' | 'RPE',
  periodo: string,
  filas: readonly FilaTrabajadorPlanilla[],
): ArchivoPlanilla {
  const lineas = filas.map((f) => [escTxt(f.cedula), escTxt(f.nombre), f.base, f.trabajador, f.patrono].join(';'));
  return {
    filename: `tiuna-${regimen.toLowerCase()}-${periodo}.txt`,
    contentType: 'text/plain; charset=utf-8',
    contenido: lineas.join('\r\n') + (lineas.length ? '\r\n' : ''),
  };
}

/** FAOV (BANAVIH): TXT con `cédula;nombre;salario_integral;1%_trabajador;2%_patrono`. */
export function generarFaovTxt(periodo: string, filas: readonly FilaTrabajadorPlanilla[]): ArchivoPlanilla {
  const lineas = filas.map((f) => [escTxt(f.cedula), escTxt(f.nombre), f.base, f.trabajador, f.patrono].join(';'));
  return {
    filename: `faov-${periodo}.txt`,
    contentType: 'text/plain; charset=utf-8',
    contenido: lineas.join('\r\n') + (lineas.length ? '\r\n' : ''),
  };
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** INCES: SpreadsheetML 2003 (Excel) con columnas base/trabajador/patrono por trabajador. */
export function generarIncesExcel(periodo: string, filas: readonly FilaTrabajadorPlanilla[]): ArchivoPlanilla {
  const cab = ['Cédula', 'Nombre', 'Base', 'Trabajador (0,5%)', 'Patrono (2%)'];
  const filaXml = (cells: readonly { v: string; num?: boolean }[]): string =>
    '<Row>' + cells.map((c) => `<Cell><Data ss:Type="${c.num ? 'Number' : 'String'}">${escXml(c.v)}</Data></Cell>`).join('') + '</Row>';
  const encabezado = '<Row>' + cab.map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escXml(c)}</Data></Cell>`).join('') + '</Row>';
  const cuerpo = filas
    .map((f) => filaXml([{ v: f.cedula }, { v: f.nombre }, { v: f.base, num: true }, { v: f.trabajador, num: true }, { v: f.patrono, num: true }]))
    .join('');
  const xml =
    '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/></Style></Styles>' +
    `<Worksheet ss:Name="INCES ${escXml(periodo)}"><Table>` +
    encabezado +
    cuerpo +
    '</Table></Worksheet></Workbook>';
  return { filename: `inces-${periodo}.xls`, contentType: 'application/vnd.ms-excel', contenido: xml };
}
