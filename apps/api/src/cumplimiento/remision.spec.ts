import { describe, expect, it } from 'vitest';
import { RemisionAdapterDePrueba, type RegistroParaRemision, StubRemisionAdapter } from './remision-adapter';

/**
 * Contrato del adapter de remisión (P17/P25, Providencia 121 §6.3 req. 2). El stub reporta el canal
 * como no disponible (REINTENTABLE) mientras el SENIAT no publique la especificación; el adapter de
 * prueba ejercita el contrato extremo a extremo (serializar→firmar→enviar→acuse) en modo síncrono y
 * asíncrono. La lógica de estados/backoff/idempotencia de la cola se prueba contra Postgres en
 * cumplimiento.int.spec.ts.
 */
function registro(idempotencyKey: string, intento = 0): RegistroParaRemision {
  return { idempotencyKey, documentId: null, payload: { doc: idempotencyKey }, intento };
}

describe('StubRemisionAdapter', () => {
  it('reporta el canal como no disponible y reintentable', async () => {
    const resultado = await new StubRemisionAdapter().transmitir(registro('d1'));
    expect(resultado.tipo).toBe('REINTENTABLE');
    if (resultado.tipo === 'REINTENTABLE') {
      expect(resultado.motivo).toMatch(/no disponible/i);
    }
  });
});

describe('RemisionAdapterDePrueba', () => {
  it('canal síncrono: acusa de inmediato con constancia y firma del sobre', async () => {
    const resultado = await new RemisionAdapterDePrueba().transmitir(registro('k1'));
    expect(resultado.tipo).toBe('ACUSADO');
    if (resultado.tipo === 'ACUSADO') {
      expect(resultado.acuseRef).toBe('AC-k1');
      expect(resultado.acuse).toMatchObject({ recibido: true, algoritmoFirma: 'sha256-PLACEHOLDER' });
    }
  });

  it('idempotencia del canal: un reenvío con el mismo idempotencyKey se marca como reenvio', async () => {
    const adapter = new RemisionAdapterDePrueba();
    await adapter.transmitir(registro('k2'));
    const segundo = await adapter.transmitir(registro('k2'));
    expect(segundo.tipo).toBe('ACUSADO');
    if (segundo.tipo === 'ACUSADO') expect(segundo.acuse).toMatchObject({ reenvio: true });
  });

  it('canal asíncrono: transmitir devuelve ENVIADO y el acuse llega tras consultar', async () => {
    const adapter = new RemisionAdapterDePrueba({ asincrono: true, consultasHastaAcuse: 2 });
    const envio = await adapter.transmitir(registro('k3'));
    expect(envio.tipo).toBe('ENVIADO');
    if (envio.tipo !== 'ENVIADO') return;

    const primera = await adapter.consultarAcuse(envio.refEnvio, registro('k3'));
    expect(primera.tipo).toBe('PENDIENTE');
    const segunda = await adapter.consultarAcuse(envio.refEnvio, registro('k3'));
    expect(segunda.tipo).toBe('ACUSADO');
    if (segunda.tipo === 'ACUSADO') expect(segunda.acuseRef).toBe('AC-k3');
  });

  it('consultarAcuse de una referencia desconocida es PERMANENTE', async () => {
    const adapter = new RemisionAdapterDePrueba({ asincrono: true });
    const r = await adapter.consultarAcuse('ENV-desconocido', registro('k4'));
    expect(r.tipo).toBe('PERMANENTE');
  });
});
