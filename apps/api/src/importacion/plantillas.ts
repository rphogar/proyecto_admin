import type { EntidadImport } from './parsers/tipos';

/**
 * Plantillas descargables de los importadores de migración (P31): CSV (separador `;`, formato es-VE) y
 * Excel (SpreadsheetML 2003, sin dependencias — mismo enfoque que `impuestos/export/libro-excel.ts`).
 * Las cabeceras coinciden con el parser GENERICO (`sistema=GENERICO`), así que descargar → llenar →
 * subir funciona sin mapeo manual. Cada plantilla trae una fila de EJEMPLO (datos anonimizados) que el
 * usuario reemplaza.
 */

interface Plantilla {
  readonly nombre: string;
  readonly columnas: readonly string[];
  /** Filas de ejemplo (mismo orden que `columnas`). */
  readonly ejemplos: ReadonlyArray<readonly string[]>;
}

const PLANTILLAS: Record<EntidadImport, Plantilla> = {
  TERCEROS: {
    nombre: 'terceros',
    columnas: [
      'tipo',
      'rif',
      'razon_social',
      'condicion_iva',
      'es_agente_retencion_iva',
      'pct_retencion_iva',
      'es_agente_retencion_islr',
      'direccion_fiscal',
      'email',
      'telefono',
      'dias_credito',
    ],
    ejemplos: [
      ['cliente', 'J-12345678-4', 'Distribuidora Ejemplo C.A.', 'ordinario', 'no', '', 'no', 'Av. Principal, Caracas', 'compras@ejemplo.com', '0212-5550000', '30'],
      ['proveedor', 'J-87654321-3', 'Suministros Especial C.A.', 'especial', 'si', '75', 'si', 'Zona Industrial, Valencia', 'ventas@suministros.com', '0241-5551111', '0'],
    ],
  },
  ITEMS: {
    nombre: 'items',
    columnas: ['sku', 'descripcion', 'tipo', 'alicuota_iva', 'unidad', 'costo', 'precio', 'moneda'],
    ejemplos: [
      ['PROD-001', 'Producto de ejemplo', 'producto', 'GENERAL', 'UND', '10.00', '18.00', 'USD'],
      ['SERV-001', 'Servicio de ejemplo', 'servicio', 'GENERAL', 'HORA', '', '25.00', 'USD'],
    ],
  },
  CXC: {
    nombre: 'cxc-abiertas',
    columnas: ['rif', 'documento', 'fecha', 'vencimiento', 'moneda', 'monto', 'rate_bcv', 'cuenta'],
    ejemplos: [
      ['J-12345678-4', 'FAC-001234', '2026-05-15', '2026-06-14', 'VES', '15000.00', '', ''],
      ['J-12345678-4', 'FAC-001240', '2026-05-20', '2026-06-19', 'USD', '120.00', '40.50', ''],
    ],
  },
  CXP: {
    nombre: 'cxp-abiertas',
    columnas: ['rif', 'documento', 'fecha', 'vencimiento', 'moneda', 'monto', 'rate_bcv', 'cuenta'],
    ejemplos: [['J-87654321-3', 'FACT-5567', '2026-05-10', '2026-06-09', 'USD', '300.00', '40.50', '']],
  },
  SALDOS: {
    nombre: 'saldos-iniciales',
    columnas: ['cuenta', 'naturaleza', 'descripcion', 'moneda', 'monto', 'rate_bcv', 'sku', 'cantidad', 'fecha_origen'],
    ejemplos: [
      ['1.1.01', 'ACTIVO', 'Caja Bs', 'VES', '5000.00', '', '', '', ''],
      ['1.1.04', 'ACTIVO', 'Banco custodia USD', 'USD', '1200.00', '40.50', '', '', ''],
      ['1.4', 'ACTIVO', 'Inventario inicial', 'USD', '500.00', '40.50', 'PROD-001', '50', '2025-12-01'],
    ],
  },
};

/** Escapa un campo CSV (separador `;`): comillas dobles si trae `;`, comillas o saltos de línea. */
function campoCsv(v: string): string {
  return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV descargable de la plantilla (con BOM para que Excel respete acentos y separador). */
export function plantillaCsv(entidad: EntidadImport): { contenido: string; filename: string } {
  const p = PLANTILLAS[entidad];
  const filas = [p.columnas, ...p.ejemplos];
  const cuerpo = filas.map((fila) => fila.map(campoCsv).join(';')).join('\r\n');
  return { contenido: `${cuerpo}\r\n`, filename: `plantilla-${p.nombre}.csv` };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Excel (SpreadsheetML 2003) descargable de la plantilla. */
export function plantillaExcel(entidad: EntidadImport): { buffer: Buffer; filename: string } {
  const p = PLANTILLAS[entidad];
  const encabezado =
    '<Row>' + p.columnas.map((c) => `<Cell ss:StyleID="hdr"><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('') + '</Row>';
  const filas = p.ejemplos
    .map((fila) => '<Row>' + fila.map((v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('') + '</Row>')
    .join('');
  const xml =
    '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
    '<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/></Style></Styles>' +
    `<Worksheet ss:Name="${esc(p.nombre)}"><Table>` +
    encabezado +
    filas +
    '</Table></Worksheet></Workbook>';
  return { buffer: Buffer.from(xml, 'utf8'), filename: `plantilla-${p.nombre}.xls` };
}

/** Nombres de columna de una plantilla (para tests y documentación). */
export function columnasPlantilla(entidad: EntidadImport): readonly string[] {
  return PLANTILLAS[entidad].columnas;
}
