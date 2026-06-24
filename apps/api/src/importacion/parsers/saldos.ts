import { columnaPorSinonimos, type CsvParseado, tieneAlgunaColumna } from './csv';
import type { FilaCruda, ParserImportacion, SaldoCrudo } from './tipos';

/**
 * Parser de SALDOS INICIALES para la migración (P31, caso 45): caja, bancos, inventario y otros activos
 * o pasivos que se integran al asiento de apertura (P30). Cada renglón lleva cuenta, naturaleza, moneda
 * y monto; el inventario añade SKU, cantidad y **fecha de origen** (para la reexpresión, docs/03 §3). El
 * patrimonio (capital y el plug de resultados acumulados) lo calcula el asiento de apertura, no se importa.
 */

const SIN = {
  cuenta: ['cuenta', 'cuenta_contable', 'codigo_cuenta', 'codigo'],
  naturaleza: ['naturaleza', 'tipo', 'debe_haber', 'activo_pasivo'],
  descripcion: ['descripcion', 'detalle', 'concepto', 'nombre'],
  moneda: ['moneda', 'divisa', 'currency'],
  monto: ['monto', 'saldo', 'valor', 'importe', 'total'],
  rateBcv: ['rate_bcv', 'tasa', 'tasa_bcv', 'tasa_cambio', 'rate'],
  sku: ['sku', 'codigo_articulo', 'item', 'referencia'],
  cantidad: ['cantidad', 'qty', 'existencia', 'stock', 'unidades'],
  fechaOrigen: ['fecha_origen', 'fecha_costo', 'fecha_adquisicion', 'fecha'],
} as const;

function mapearFila(fila: Record<string, string>): SaldoCrudo {
  return {
    cuenta: columnaPorSinonimos(fila, SIN.cuenta),
    naturaleza: columnaPorSinonimos(fila, SIN.naturaleza),
    descripcion: columnaPorSinonimos(fila, SIN.descripcion),
    moneda: columnaPorSinonimos(fila, SIN.moneda),
    monto: columnaPorSinonimos(fila, SIN.monto),
    rateBcv: columnaPorSinonimos(fila, SIN.rateBcv),
    sku: columnaPorSinonimos(fila, SIN.sku),
    cantidad: columnaPorSinonimos(fila, SIN.cantidad),
    fechaOrigen: columnaPorSinonimos(fila, SIN.fechaOrigen),
  };
}

function filasDe(csv: CsvParseado): Array<FilaCruda<SaldoCrudo>> {
  return csv.filas.map((f, i) => ({ fila: i + 1, datos: mapearFila(f) }));
}

export const parserSaldosGenericoV1: ParserImportacion<SaldoCrudo> = {
  entidad: 'SALDOS',
  sistema: 'GENERICO',
  version: 'saldos-generico-v1',
  detecta(cabeceras, nombreArchivo) {
    return (tieneAlgunaColumna(cabeceras, SIN.cuenta) && tieneAlgunaColumna(cabeceras, SIN.monto)) || /saldo|apertura|balance/i.test(nombreArchivo);
  },
  parse(csv) {
    return { entidad: 'SALDOS', sistema: 'GENERICO', version: this.version, filas: filasDe(csv) };
  },
};
