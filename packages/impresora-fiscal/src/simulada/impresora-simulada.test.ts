import { describe, expect, it } from 'vitest';
import { mapearDocumentoAComandos } from '../mapeo/mapear-documento';
import type { DocumentoParaImpresion } from '../mapeo/comando-fiscal';
import { ImpresoraFiscalSimulada } from './impresora-simulada';

const DOC: DocumentoParaImpresion = {
  tipo: 'FACTURA',
  adquirente: { tipo: 'CONSUMIDOR_FINAL' },
  lineas: [{ descripcion: 'X', cantidad: '1', precioUnitario: '1000', alicuotaCodigo: 'GENERAL', alicuotaTasa: '16' }],
  mediosPago: [{ tipo: 'EFECTIVO', monto: '1160' }],
};
const COMANDOS = mapearDocumentoAComandos(DOC);

describe('ImpresoraFiscalSimulada — máquina fiscal en memoria (P23)', () => {
  it('asigna numeración fiscal estrictamente consecutiva', async () => {
    const imp = new ImpresoraFiscalSimulada({ serie: 'SIM' });
    const a = await imp.imprimirDocumento(COMANDOS);
    const b = await imp.imprimirDocumento(COMANDOS);
    expect(a).toMatchObject({ tipo: 'IMPRESO', numeroFiscal: '00000001', controlFiscal: 'SIM-00000001' });
    expect(b).toMatchObject({ tipo: 'IMPRESO', numeroFiscal: '00000002', controlFiscal: 'SIM-00000002' });
  });

  it('respeta el contador inicial `desde`', async () => {
    const imp = new ImpresoraFiscalSimulada({ desde: 40 });
    expect(await imp.imprimirDocumento(COMANDOS)).toMatchObject({ numeroFiscal: '00000041' });
  });

  it('contingencia (caída) → REINTENTABLE y NO consume numeración; al reparar continúa el consecutivo', async () => {
    const imp = new ImpresoraFiscalSimulada();
    imp.caer();
    expect(await imp.imprimirDocumento(COMANDOS)).toEqual({
      tipo: 'REINTENTABLE',
      motivo: 'Impresora fiscal simulada en contingencia (caída)',
    });
    imp.reparar();
    expect(await imp.imprimirDocumento(COMANDOS)).toMatchObject({ tipo: 'IMPRESO', numeroFiscal: '00000001' });
  });

  it('rechazo → PERMANENTE', async () => {
    const imp = new ImpresoraFiscalSimulada();
    imp.rechazar();
    expect((await imp.imprimirDocumento(COMANDOS)).tipo).toBe('PERMANENTE');
  });

  it('una secuencia sin CERRAR_DOC se rechaza como PERMANENTE', async () => {
    const imp = new ImpresoraFiscalSimulada();
    const sinCerrar = COMANDOS.filter((c) => c.clase !== 'CERRAR_DOC');
    expect((await imp.imprimirDocumento(sinCerrar)).tipo).toBe('PERMANENTE');
  });

  it('reporte Z avanza el contador de cierres; X no lo avanza; memoria fiscal refleja totales', async () => {
    const imp = new ImpresoraFiscalSimulada();
    await imp.imprimirDocumento(COMANDOS);
    const x = await imp.reporteX();
    const z = await imp.reporteZ();
    const mem = await imp.leerMemoriaFiscal({ desdeZ: 1, hastaZ: 1 });
    expect(x).toMatchObject({ tipo: 'OK', reporte: { clase: 'X', datos: { cierresZ: 0 } } });
    expect(z).toMatchObject({ tipo: 'OK', reporte: { clase: 'Z', datos: { numeroZ: 1 } } });
    expect(mem).toMatchObject({ tipo: 'OK', reporte: { clase: 'MEMORIA', datos: { totalCierresZ: 1, totalDocumentos: 1 } } });
  });
});
