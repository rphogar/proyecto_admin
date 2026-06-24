import { columnaPorSinonimos, type CsvParseado, tieneAlgunaColumna } from './csv';
import type { FilaCruda, ItemCrudo, ParserImportacion } from './tipos';

/**
 * Parsers de ÍTEMS (productos/servicios) para la migración (P31): GENERICO (plantilla) y GALAC. El ítem
 * trae costo y alícuota (instrucción P31); el costo alimenta la valoración del inventario de apertura
 * cuando el mismo SKU aparece en los saldos iniciales (caso 45) y el precio se carga en la lista por
 * defecto. Dedup por SKU en `mapeo.ts`.
 */

const SIN = {
  sku: ['sku', 'codigo', 'cod', 'codigo_articulo', 'referencia', 'item'],
  descripcion: ['descripcion', 'nombre', 'detalle', 'articulo'],
  tipo: ['tipo', 'tipo_item', 'producto_servicio'],
  alicuotaIva: ['alicuota_iva', 'alicuota', 'iva', 'tasa_iva', 'categoria_iva', 'tipo_iva'],
  unidad: ['unidad', 'um', 'unidad_medida', 'medida'],
  costo: ['costo', 'costo_unitario', 'costo_promedio', 'ultimo_costo'],
  precio: ['precio', 'precio_venta', 'pvp', 'precio_unitario'],
  moneda: ['moneda', 'divisa', 'currency'],
} as const;

function mapearFila(fila: Record<string, string>): ItemCrudo {
  return {
    sku: columnaPorSinonimos(fila, SIN.sku),
    descripcion: columnaPorSinonimos(fila, SIN.descripcion),
    tipo: columnaPorSinonimos(fila, SIN.tipo),
    alicuotaIva: columnaPorSinonimos(fila, SIN.alicuotaIva),
    unidad: columnaPorSinonimos(fila, SIN.unidad),
    costo: columnaPorSinonimos(fila, SIN.costo),
    precio: columnaPorSinonimos(fila, SIN.precio),
    moneda: columnaPorSinonimos(fila, SIN.moneda),
  };
}

function filasDe(csv: CsvParseado): Array<FilaCruda<ItemCrudo>> {
  return csv.filas.map((f, i) => ({ fila: i + 1, datos: mapearFila(f) }));
}

export const parserItemsGenericoV1: ParserImportacion<ItemCrudo> = {
  entidad: 'ITEMS',
  sistema: 'GENERICO',
  version: 'items-generico-v1',
  detecta(cabeceras, nombreArchivo) {
    return (tieneAlgunaColumna(cabeceras, SIN.sku) && tieneAlgunaColumna(cabeceras, SIN.descripcion)) || /item|articulo|producto/i.test(nombreArchivo);
  },
  parse(csv) {
    return { entidad: 'ITEMS', sistema: 'GENERICO', version: this.version, filas: filasDe(csv) };
  },
};

export const parserItemsGalacV1: ParserImportacion<ItemCrudo> = {
  entidad: 'ITEMS',
  sistema: 'GALAC',
  version: 'items-galac-v1',
  detecta(cabeceras, nombreArchivo) {
    return /galac/i.test(nombreArchivo) && tieneAlgunaColumna(cabeceras, SIN.sku);
  },
  parse(csv) {
    return { entidad: 'ITEMS', sistema: 'GALAC', version: this.version, filas: filasDe(csv) };
  },
};
