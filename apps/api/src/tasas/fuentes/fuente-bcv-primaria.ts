import { get as httpsGet } from 'node:https';
import { Injectable } from '@nestjs/common';
import type { FuenteTasaBcv, TasaBcvCapturada } from './fuente-bcv';
import { parsearTasasBcv } from './parser-bcv';

const URL_BCV = process.env.TASAS_BCV_URL ?? 'https://www.bcv.org.ve/';
const TIMEOUT_MS = Number(process.env.TASAS_BCV_TIMEOUT_MS ?? 15_000);
// El portal del BCV presenta una cadena de certificado que Node no logra verificar
// (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Opt-in EXPLÍCITO para no verificar TLS SOLO en esta descarga
// (dato público, server-side); por defecto se verifica. Alternativa: apuntar TASAS_BCV_URL a un proxy.
const TLS_INSECURE = process.env.TASAS_BCV_TLS_INSECURE === 'true';

/** Descarga segura (verifica TLS) vía fetch global. */
async function descargarSeguro(url: string): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`BCV respondió ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(t);
  }
}

/** Descarga sin verificar TLS (node:https, opt-in). Sigue una redirección simple. */
function descargarInseguro(url: string, redireccionesRestantes = 3): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { rejectUnauthorized: false, timeout: TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location !== undefined && redireccionesRestantes > 0) {
        res.resume();
        descargarInseguro(new URL(location, url).toString(), redireccionesRestantes - 1).then(
          resolve,
          reject,
        );
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`BCV respondió ${status}`));
        return;
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('timeout BCV')));
    req.on('error', reject);
  });
}

/**
 * Fuente PRIMARIA: descarga el HTML del portal del BCV y lo delega a `parsearTasasBcv`. El
 * `fetch`/`https` es lo único no testeable offline; el parsing (la parte frágil) se prueba con fixture.
 */
@Injectable()
export class FuenteBcvPrimaria implements FuenteTasaBcv {
  readonly nombre = 'BCV-web';

  async obtener(_fecha: string): Promise<readonly TasaBcvCapturada[]> {
    const html = TLS_INSECURE ? await descargarInseguro(URL_BCV) : await descargarSeguro(URL_BCV);
    return parsearTasasBcv(html);
  }
}
