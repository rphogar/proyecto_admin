import { Decimal } from '@contave/shared';
import type { ComandoFiscal, DocumentoParaImpresion } from './comando-fiscal';

/**
 * Mapeo PURO y DETERMINISTA documento→comandos fiscales (P23, docs/06 M1). Produce la secuencia
 * canónica de comandos abstractos que cualquier driver de marca traduce a su protocolo. No formatea
 * tramas ni redondea importes (eso es del driver): aquí solo se decide QUÉ comandos y en qué orden.
 *
 * Determinismo: misma entrada ⇒ misma salida byte-idéntica (testeable golden-style).
 */
export function mapearDocumentoAComandos(doc: DocumentoParaImpresion): ComandoFiscal[] {
  if (doc.lineas.length === 0) {
    throw new Error('El documento no tiene líneas: la máquina fiscal no admite documentos vacíos');
  }
  if (doc.tipo !== 'FACTURA' && (doc.documentoAfectado === undefined || doc.documentoAfectado === null)) {
    throw new Error(`${doc.tipo} requiere la referencia a la factura fiscal afectada`);
  }
  if (doc.mediosPago.length === 0) {
    throw new Error('El documento no declara medios de pago');
  }

  const comandos: ComandoFiscal[] = [];

  comandos.push({
    clase: 'ABRIR_DOC',
    tipoDoc: doc.tipo,
    adquirente: doc.adquirente,
    afectado: doc.documentoAfectado ?? null,
  });

  for (const l of doc.lineas) {
    comandos.push({
      clase: 'LINEA',
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      alicuotaCodigo: l.alicuotaCodigo,
      alicuotaTasa: l.alicuotaTasa,
    });
    const descuento = new Decimal(l.descuento ?? '0');
    if (descuento.gt(0)) {
      comandos.push({ clase: 'DESCUENTO_LINEA', monto: descuento.toFixed() });
    }
  }

  comandos.push({ clase: 'SUBTOTAL' });

  for (const p of doc.mediosPago) {
    comandos.push({
      clase: 'MEDIO_PAGO',
      tipo: p.tipo,
      descripcion: p.descripcion ?? '',
      monto: p.monto,
    });
  }

  comandos.push({ clase: 'CERRAR_DOC' });
  return comandos;
}
