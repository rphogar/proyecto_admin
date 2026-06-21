import { describe, expect, it } from 'vitest';
import type { SolicitudControlDigital, SolicitudEntrega } from '../adapter/imprenta-digital';
import { construirControlVerificable } from '../control/control-verificable';
import { construirDocumentoDigital, type DocumentoDigital } from '../documento/documento-digital';
import { ImprentaDigitalSimulada } from './imprenta-simulada';

const SOLICITUD: SolicitudControlDigital = {
  rifEmisor: 'J-12345678-9',
  tipoDocumento: 'FACTURA',
  serie: 'A',
  fechaEmision: '2026-06-12T14:00:00.000Z',
  rifAdquirente: 'J-98765432-1',
  totalVes: '2320.00',
  hashContenido: 'hash-contenido',
};

function documentoConControl(numeroControl: string): DocumentoDigital {
  const control = construirControlVerificable({
    rifEmisor: 'J-12345678-9',
    numeroControl,
    tipoDocumento: 'FACTURA',
    serie: 'A',
    numero: 1,
    fechaFiscal: '2026-06-12',
    rifAdquirente: 'J-98765432-1',
    totalVes: '2320.00',
    hashIntegridad: 'hash-doc',
    baseUrlVerificacion: 'https://v.example',
  });
  return construirDocumentoDigital({
    tipoDocumento: 'FACTURA',
    emisor: { rif: 'J-12345678-9', razonSocial: 'Empresa A C.A.', domicilioFiscal: 'Caracas' },
    serie: 'A',
    numero: 1,
    numeroControl,
    adquirente: { esConsumidorFinal: false, rif: 'J-98765432-1', nombre: 'Cliente A C.A.' },
    fechaEmision: '2026-06-12T14:00:00.000Z',
    fechaFiscal: '2026-06-12',
    moneda: 'VES',
    rateBcv: null,
    totalOrigen: '2320.00',
    totalVes: '2320.00',
    condicionPago: 'CONTADO',
    lineas: [],
    impuestos: [],
    hashIntegridad: 'hash-doc',
    control,
  });
}

describe('ImprentaDigitalSimulada (P24)', () => {
  it('asigna números de control digitales consecutivos', async () => {
    const imp = new ImprentaDigitalSimulada({ prefijo: 'DIG' });
    const r1 = await imp.asignarControl(SOLICITUD);
    const r2 = await imp.asignarControl(SOLICITUD);
    expect(r1).toMatchObject({ tipo: 'ASIGNADO', numeroControl: 'DIG-00000001' });
    expect(r2).toMatchObject({ tipo: 'ASIGNADO', numeroControl: 'DIG-00000002' });
    expect(imp.controlesAsignados).toHaveLength(2);
  });

  it('entrega por correo y registra el acuse con el identificador del control', async () => {
    const imp = new ImprentaDigitalSimulada();
    const doc = documentoConControl('DIG-00000001');
    const entrega: SolicitudEntrega = { documento: doc, destinatario: { canal: 'EMAIL', direccion: 'cliente@correo.com' } };
    const r = await imp.entregar(entrega);
    expect(r.tipo).toBe('ENTREGADO');
    if (r.tipo === 'ENTREGADO') {
      expect(r.acuse).toMatchObject({ numeroControl: 'DIG-00000001', identificador: doc.control.identificador });
    }
    expect(imp.entregas).toHaveLength(1);
  });

  it('rechaza (PERMANENTE) un correo inválido', async () => {
    const imp = new ImprentaDigitalSimulada();
    const r = await imp.entregar({
      documento: documentoConControl('DIG-00000001'),
      destinatario: { canal: 'EMAIL', direccion: 'sin-arroba' },
    });
    expect(r.tipo).toBe('PERMANENTE');
  });

  it('conserva con referencia y retención', async () => {
    const imp = new ImprentaDigitalSimulada();
    const r = await imp.conservar({ documento: documentoConControl('DIG-00000001'), retencionAnios: 10 });
    expect(r).toMatchObject({ tipo: 'CONSERVADO', referencia: 'CONS-DIG-00000001' });
  });

  it('contingencia: caída ⇒ REINTENTABLE; rechazo ⇒ PERMANENTE; reparar ⇒ OK', async () => {
    const imp = new ImprentaDigitalSimulada();
    imp.caer();
    expect((await imp.asignarControl(SOLICITUD)).tipo).toBe('REINTENTABLE');
    expect((await imp.entregar({ documento: documentoConControl('X'), destinatario: { canal: 'EMAIL', direccion: 'a@b.com' } })).tipo).toBe('REINTENTABLE');
    imp.rechazar();
    expect((await imp.asignarControl(SOLICITUD)).tipo).toBe('PERMANENTE');
    imp.reparar();
    expect((await imp.asignarControl(SOLICITUD)).tipo).toBe('ASIGNADO');
  });
});
