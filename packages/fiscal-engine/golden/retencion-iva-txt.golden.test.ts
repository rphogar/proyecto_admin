import { describe, expect, it } from 'vitest';
import { generarTxtRetencionIva, type LineaRetencionIvaTxt } from '../src/retenciones/txt-retencion-iva';
import golden from './retencion-iva-txt.golden.json';

/**
 * Golden del TXT de retenciones de IVA (caso 33 del doc 07): la salida del generador debe coincidir
 * **byte a byte** con el archivo de ejemplo anonimizado del portal (`esperado` en el JSON). Un cambio
 * en el layout que no actualice el golden = riesgo de rechazo del portal. TODO-TRIBUTARISTA: sustituir
 * el ejemplo por un archivo real cuando se disponga de él.
 */
describe('TXT retenciones IVA — golden exacto del portal (doc 07 §C.33)', () => {
  it('genera el lote de la quincena byte a byte como el ejemplo', () => {
    const txt = generarTxtRetencionIva(golden.input as LineaRetencionIvaTxt[]);
    expect(txt).toBe(golden.esperado);
  });

  it('cada fila tiene las 17 columnas del perfil clásico', () => {
    const txt = generarTxtRetencionIva(golden.input as LineaRetencionIvaTxt[]);
    for (const fila of txt.split('\r\n')) {
      expect(fila.split('\t')).toHaveLength(17);
    }
  });
});
