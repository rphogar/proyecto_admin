import { describe, expect, it } from 'vitest';
import type { ComandoFiscal, DocumentoParaImpresion } from './comando-fiscal';
import { mapearDocumentoAComandos } from './mapear-documento';

describe('mapearDocumentoAComandos — mapeo documento→comandos fiscales (P23)', () => {
  it('factura a consumidor final, multi-alícuota con descuento de línea → secuencia canónica exacta', () => {
    const doc: DocumentoParaImpresion = {
      tipo: 'FACTURA',
      adquirente: { tipo: 'CONSUMIDOR_FINAL' },
      lineas: [
        { descripcion: 'Producto 16%', cantidad: '2', precioUnitario: '1000.00', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
        {
          descripcion: 'Producto 8% con dto',
          cantidad: '1',
          precioUnitario: '500.00',
          descuento: '50.00',
          alicuotaCodigo: 'REDUCIDA',
          alicuotaTasa: '8',
        },
        { descripcion: 'Producto exento', cantidad: '3', precioUnitario: '100.00', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      ],
      mediosPago: [{ tipo: 'EFECTIVO', monto: '3038.00' }],
    };

    const esperado: ComandoFiscal[] = [
      { clase: 'ABRIR_DOC', tipoDoc: 'FACTURA', adquirente: { tipo: 'CONSUMIDOR_FINAL' }, afectado: null },
      { clase: 'LINEA', descripcion: 'Producto 16%', cantidad: '2', precioUnitario: '1000.00', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
      { clase: 'LINEA', descripcion: 'Producto 8% con dto', cantidad: '1', precioUnitario: '500.00', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
      { clase: 'DESCUENTO_LINEA', monto: '50' },
      { clase: 'LINEA', descripcion: 'Producto exento', cantidad: '3', precioUnitario: '100.00', alicuotaCodigo: 'EXENTO', alicuotaTasa: '0' },
      { clase: 'SUBTOTAL' },
      { clase: 'MEDIO_PAGO', tipo: 'EFECTIVO', descripcion: '', monto: '3038.00' },
      { clase: 'CERRAR_DOC' },
    ];

    expect(mapearDocumentoAComandos(doc)).toEqual(esperado);
  });

  it('es determinista: misma entrada ⇒ misma salida', () => {
    const doc: DocumentoParaImpresion = {
      tipo: 'FACTURA',
      adquirente: { tipo: 'IDENTIFICADO', rif: 'J-12345678-9', nombre: 'ACME C.A.' },
      lineas: [{ descripcion: 'X', cantidad: '1', precioUnitario: '10', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      mediosPago: [{ tipo: 'TARJETA', descripcion: 'POS', monto: '11.60' }],
    };
    expect(mapearDocumentoAComandos(doc)).toEqual(mapearDocumentoAComandos(doc));
  });

  it('abre el documento con el adquirente identificado (RIF + nombre)', () => {
    const doc: DocumentoParaImpresion = {
      tipo: 'FACTURA',
      adquirente: { tipo: 'IDENTIFICADO', rif: 'J-12345678-9', nombre: 'ACME C.A.' },
      lineas: [{ descripcion: 'X', cantidad: '1', precioUnitario: '10', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      mediosPago: [{ tipo: 'EFECTIVO', monto: '11.60' }],
    };
    const [primero] = mapearDocumentoAComandos(doc);
    expect(primero).toEqual({
      clase: 'ABRIR_DOC',
      tipoDoc: 'FACTURA',
      adquirente: { tipo: 'IDENTIFICADO', rif: 'J-12345678-9', nombre: 'ACME C.A.' },
      afectado: null,
    });
  });

  it('una NC/ND exige la referencia a la factura afectada', () => {
    const ncSinRef: DocumentoParaImpresion = {
      tipo: 'NOTA_CREDITO',
      adquirente: { tipo: 'CONSUMIDOR_FINAL' },
      lineas: [{ descripcion: 'Devolución', cantidad: '1', precioUnitario: '10', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
      mediosPago: [{ tipo: 'EFECTIVO', monto: '11.60' }],
    };
    expect(() => mapearDocumentoAComandos(ncSinRef)).toThrow(/factura fiscal afectada/i);

    const conRef = mapearDocumentoAComandos({
      ...ncSinRef,
      documentoAfectado: { numeroFiscal: '00000123', controlFiscal: 'SIM-00000123', fecha: '2026-06-01' },
    });
    expect(conRef[0]).toMatchObject({ clase: 'ABRIR_DOC', tipoDoc: 'NOTA_CREDITO' });
  });

  it('rechaza documentos sin líneas o sin medios de pago', () => {
    expect(() =>
      mapearDocumentoAComandos({ tipo: 'FACTURA', adquirente: { tipo: 'CONSUMIDOR_FINAL' }, lineas: [], mediosPago: [{ tipo: 'EFECTIVO', monto: '0' }] }),
    ).toThrow(/no tiene líneas/i);
    expect(() =>
      mapearDocumentoAComandos({
        tipo: 'FACTURA',
        adquirente: { tipo: 'CONSUMIDOR_FINAL' },
        lineas: [{ descripcion: 'X', cantidad: '1', precioUnitario: '10', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
        mediosPago: [],
      }),
    ).toThrow(/medios de pago/i);
  });
});
