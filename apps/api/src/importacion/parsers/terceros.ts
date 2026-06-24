import { columnaPorSinonimos, type CsvParseado, tieneAlgunaColumna } from './csv';
import type { FilaCruda, ParserImportacion, TerceroCrudo } from './tipos';

/**
 * Parsers de TERCEROS (clientes/proveedores) para la migración (P31). Dos sistemas de origen como
 * demostración del patrón versionado (docs/05 §5): GENERICO (la plantilla descargable del sistema) y
 * GALAC (cabeceras del export del software contable Gálac). Añadir Profit u otra versión es agregar
 * un parser aquí sin tocar el importador. El parser mapea por **sinónimos de columna**, así que tolera
 * variaciones de mayúsculas/acentos en las cabeceras.
 */

/** Sinónimos de cada campo canónico (normalizados con `claveCabecera`). */
const SIN = {
  tipo: ['tipo', 'tipo_tercero', 'clasificacion', 'es_cliente_proveedor'],
  rif: ['rif', 'rif_ci', 'documento', 'nro_rif', 'numero_rif', 'cedula_rif'],
  razonSocial: ['razon_social', 'razonsocial', 'nombre', 'nombre_o_razon_social', 'descripcion'],
  condicionIva: ['condicion_iva', 'condicion', 'tipo_contribuyente', 'contribuyente'],
  esAgenteRetencionIva: ['es_agente_retencion_iva', 'agente_retencion_iva', 'retiene_iva', 'agente_iva'],
  pctRetencionIva: ['pct_retencion_iva', 'porcentaje_retencion_iva', 'retencion_iva', 'pct_iva'],
  esAgenteRetencionIslr: ['es_agente_retencion_islr', 'agente_retencion_islr', 'retiene_islr', 'agente_islr'],
  direccionFiscal: ['direccion_fiscal', 'direccion', 'domicilio_fiscal', 'domicilio'],
  email: ['email', 'correo', 'correo_electronico', 'e_mail'],
  telefono: ['telefono', 'tlf', 'celular', 'movil'],
  diasCredito: ['dias_credito', 'dias_de_credito', 'credito_dias', 'plazo'],
} as const;

function mapearFila(fila: Record<string, string>): TerceroCrudo {
  return {
    tipo: columnaPorSinonimos(fila, SIN.tipo),
    rif: columnaPorSinonimos(fila, SIN.rif),
    razonSocial: columnaPorSinonimos(fila, SIN.razonSocial),
    condicionIva: columnaPorSinonimos(fila, SIN.condicionIva),
    esAgenteRetencionIva: columnaPorSinonimos(fila, SIN.esAgenteRetencionIva),
    pctRetencionIva: columnaPorSinonimos(fila, SIN.pctRetencionIva),
    esAgenteRetencionIslr: columnaPorSinonimos(fila, SIN.esAgenteRetencionIslr),
    direccionFiscal: columnaPorSinonimos(fila, SIN.direccionFiscal),
    email: columnaPorSinonimos(fila, SIN.email),
    telefono: columnaPorSinonimos(fila, SIN.telefono),
    diasCredito: columnaPorSinonimos(fila, SIN.diasCredito),
  };
}

function filasDe(csv: CsvParseado): Array<FilaCruda<TerceroCrudo>> {
  return csv.filas.map((f, i) => ({ fila: i + 1, datos: mapearFila(f) }));
}

/** Plantilla descargable del sistema (formato canónico). */
export const parserTercerosGenericoV1: ParserImportacion<TerceroCrudo> = {
  entidad: 'TERCEROS',
  sistema: 'GENERICO',
  version: 'terceros-generico-v1',
  detecta(cabeceras, nombreArchivo) {
    const tieneRif = tieneAlgunaColumna(cabeceras, SIN.rif);
    const tieneNombre = tieneAlgunaColumna(cabeceras, SIN.razonSocial);
    return (tieneRif && tieneNombre) || /tercero/i.test(nombreArchivo);
  },
  parse(csv) {
    return { entidad: 'TERCEROS', sistema: 'GENERICO', version: this.version, filas: filasDe(csv) };
  },
};

/**
 * Export de Gálac: cabeceras propias ("Rif", "Razon Social", "Tipo Contribuyente", "Retiene IVA"…).
 * Los sinónimos ya las cubren; `detecta` se ancla a la firma típica de Gálac + el nombre de archivo.
 */
export const parserTercerosGalacV1: ParserImportacion<TerceroCrudo> = {
  entidad: 'TERCEROS',
  sistema: 'GALAC',
  version: 'terceros-galac-v1',
  detecta(cabeceras, nombreArchivo) {
    return /galac/i.test(nombreArchivo) && tieneAlgunaColumna(cabeceras, SIN.rif);
  },
  parse(csv) {
    return { entidad: 'TERCEROS', sistema: 'GALAC', version: this.version, filas: filasDe(csv) };
  },
};
