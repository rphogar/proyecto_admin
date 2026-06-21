import { describe, expect, it, vi } from 'vitest';
import type { ComandoFiscal } from '../../mapeo/comando-fiscal';
import { mapearDocumentoAComandos } from '../../mapeo/mapear-documento';
import { DriverTheFactoryHka } from './driver-hka';
import { construirTramas } from './protocolo-hka';
import type { RespuestaTrama, TramaHka, TransporteSerie } from './transporte-serie';

const COMANDOS: ComandoFiscal[] = mapearDocumentoAComandos({
  tipo: 'FACTURA',
  adquirente: { tipo: 'IDENTIFICADO', rif: 'J-12345678-9', nombre: 'ACME C.A.' },
  lineas: [
    { descripcion: 'Producto 16%', cantidad: '2', precioUnitario: '1000.00', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' },
    { descripcion: 'Servicio 8% dto', cantidad: '1', precioUnitario: '500.00', descuento: '50', alicuotaCodigo: 'REDUCIDA', alicuotaTasa: '8' },
  ],
  mediosPago: [{ tipo: 'EFECTIVO', monto: '2734.00' }],
});

/** Transporte simulado: el cierre devuelve la numeración fiscal del hardware. */
function transporteOk(): TransporteSerie {
  return {
    async enviar(trama: TramaHka): Promise<RespuestaTrama> {
      if (trama.comando === 'CERRAR') {
        return { ok: true, codigo: 'OK', datos: { numeroFiscal: '00000042', controlFiscal: 'HKA-00000042' } };
      }
      return { ok: true, codigo: 'OK' };
    },
  };
}

/** Imprime los COMANDOS del documento con el transporte dado. */
function imprimirCon(transporte: TransporteSerie) {
  return new DriverTheFactoryHka(transporte).imprimirDocumento(COMANDOS);
}

describe('DriverTheFactoryHka — traducción y desenlaces (P23)', () => {
  it('construirTramas: el cliente identificado añade RIF y nombre antes de abrir; los importes van a 2 dec sin punto', () => {
    const tramas = construirTramas(COMANDOS);
    const comandos = tramas.map((t) => t.comando);
    expect(comandos).toContain('CLIENTE_RIF');
    expect(comandos).toContain('CLIENTE_NOMBRE');
    expect(comandos[comandos.length - 1]).toBe('CERRAR');
    const lineas = tramas.filter((t) => t.comando === 'LINEA');
    expect(lineas[0]?.cuerpo).toContain('100000'); // 1000.00 → '100000'
    expect(tramas.find((t) => t.comando === 'DESCUENTO')?.cuerpo).toBe('5000'); // 50 → '5000'
  });

  it('imprime y devuelve IMPRESO con la numeración fiscal del hardware', async () => {
    const driver = new DriverTheFactoryHka(transporteOk());
    const r = await driver.imprimirDocumento(COMANDOS);
    expect(r).toEqual({
      tipo: 'IMPRESO',
      numeroFiscal: '00000042',
      controlFiscal: 'HKA-00000042',
      acuse: { numeroFiscal: '00000042', controlFiscal: 'HKA-00000042' },
    });
  });

  it('contingencia: un estado recuperable (SIN_PAPEL) → REINTENTABLE', async () => {
    const transporte: TransporteSerie = { enviar: async () => ({ ok: false, codigo: 'SIN_PAPEL' }) };
    const r = await imprimirCon(transporte);
    expect(r.tipo).toBe('REINTENTABLE');
  });

  it('un rechazo fiscal (estado desconocido/definitivo) → PERMANENTE', async () => {
    const transporte: TransporteSerie = { enviar: async () => ({ ok: false, codigo: 'COMANDO_INVALIDO' }) };
    const r = await imprimirCon(transporte);
    expect(r.tipo).toBe('PERMANENTE');
  });

  it('un fallo de transporte (excepción) → REINTENTABLE (no se pierde el documento)', async () => {
    const transporte: TransporteSerie = {
      enviar: vi.fn(async () => {
        throw new Error('puerto COM no responde');
      }),
    };
    const r = await imprimirCon(transporte);
    expect(r.tipo).toBe('REINTENTABLE');
  });

  it('si el cierre no devuelve numeración fiscal → REINTENTABLE (no se cierra la venta a ciegas)', async () => {
    const transporte: TransporteSerie = { enviar: async () => ({ ok: true, codigo: 'OK' }) };
    const r = await imprimirCon(transporte);
    expect(r.tipo).toBe('REINTENTABLE');
  });

  it('reporteZ devuelve OK con los datos del cierre', async () => {
    const transporte: TransporteSerie = {
      enviar: async () => ({ ok: true, codigo: 'OK', datos: { numeroZ: 7, emitidoEn: '2026-06-20T12:00:00.000Z' } }),
    };
    const r = await new DriverTheFactoryHka(transporte).reporteZ();
    expect(r).toMatchObject({ tipo: 'OK', reporte: { clase: 'Z', datos: { numeroZ: 7 } } });
  });
});
