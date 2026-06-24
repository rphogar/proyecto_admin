import { columnaPorSinonimos, type CsvParseado, tieneAlgunaColumna } from './csv';
import type { CuentaAbiertaCruda, EntidadImport, FilaCruda, ParserImportacion } from './tipos';

/**
 * Parsers de CxC/CxP ABIERTAS para la migración (P31): saldos pendientes por documento y tercero. CxC
 * y CxP comparten estructura (cambia la entidad y la naturaleza contable), así que se generan con una
 * fábrica. Cada saldo abierto se vuelve un renglón del asiento de apertura (CxC = activo, CxP = pasivo)
 * imputado al tercero, conservando documento y vencimiento para la gestión de cobranza/pago posterior.
 */

const SIN = {
  rif: ['rif', 'rif_cliente', 'rif_proveedor', 'rif_ci', 'documento_tercero'],
  documento: ['documento', 'nro_documento', 'numero_documento', 'factura', 'nro_factura', 'control'],
  fecha: ['fecha', 'fecha_emision', 'fecha_documento', 'fecha_factura'],
  vencimiento: ['vencimiento', 'fecha_vencimiento', 'vence', 'fecha_vence'],
  moneda: ['moneda', 'divisa', 'currency'],
  monto: ['monto', 'saldo', 'saldo_pendiente', 'monto_pendiente', 'total', 'importe'],
  rateBcv: ['rate_bcv', 'tasa', 'tasa_bcv', 'tasa_cambio', 'rate'],
  cuenta: ['cuenta', 'cuenta_contable', 'codigo_cuenta'],
} as const;

function mapearFila(fila: Record<string, string>): CuentaAbiertaCruda {
  return {
    rif: columnaPorSinonimos(fila, SIN.rif),
    documento: columnaPorSinonimos(fila, SIN.documento),
    fecha: columnaPorSinonimos(fila, SIN.fecha),
    vencimiento: columnaPorSinonimos(fila, SIN.vencimiento),
    moneda: columnaPorSinonimos(fila, SIN.moneda),
    monto: columnaPorSinonimos(fila, SIN.monto),
    rateBcv: columnaPorSinonimos(fila, SIN.rateBcv),
    cuenta: columnaPorSinonimos(fila, SIN.cuenta),
  };
}

function filasDe(csv: CsvParseado): Array<FilaCruda<CuentaAbiertaCruda>> {
  return csv.filas.map((f, i) => ({ fila: i + 1, datos: mapearFila(f) }));
}

function construir(entidad: Extract<EntidadImport, 'CXC' | 'CXP'>, sistema: string, version: string): ParserImportacion<CuentaAbiertaCruda> {
  return {
    entidad,
    sistema,
    version,
    detecta(cabeceras, nombreArchivo) {
      const firma = tieneAlgunaColumna(cabeceras, SIN.rif) && tieneAlgunaColumna(cabeceras, SIN.monto);
      const patron = entidad === 'CXC' ? /cxc|cobrar|cuentas_por_cobrar/i : /cxp|pagar|cuentas_por_pagar/i;
      const galac = sistema === 'GALAC' ? /galac/i.test(nombreArchivo) : true;
      return firma && galac && (sistema !== 'GENERICO' || patron.test(nombreArchivo) || firma);
    },
    parse(csv) {
      return { entidad, sistema, version, filas: filasDe(csv) };
    },
  };
}

export const parserCxCGenericoV1 = construir('CXC', 'GENERICO', 'cxc-generico-v1');
export const parserCxPGenericoV1 = construir('CXP', 'GENERICO', 'cxp-generico-v1');
export const parserCxCGalacV1 = construir('CXC', 'GALAC', 'cxc-galac-v1');
export const parserCxPGalacV1 = construir('CXP', 'GALAC', 'cxp-galac-v1');
