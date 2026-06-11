import { Injectable } from '@nestjs/common';
import type { FuenteTasaBcv, TasaBcvCapturada } from './fuente-bcv';
import { parsearTasasBcv } from './parser-bcv';

const URL_BCV = process.env.TASAS_BCV_URL ?? 'https://www.bcv.org.ve/';
const TIMEOUT_MS = Number(process.env.TASAS_BCV_TIMEOUT_MS ?? 15_000);

/**
 * Fuente PRIMARIA: descarga el HTML del portal del BCV y lo delega a `parsearTasasBcv`. El
 * `fetch` es lo único no testeable offline; el parsing (la parte frágil) se prueba con fixture.
 * El certificado del BCV a veces es problemático; usar `TASAS_BCV_URL` para un proxy si hace falta.
 */
@Injectable()
export class FuenteBcvPrimaria implements FuenteTasaBcv {
  readonly nombre = 'BCV-web';

  async obtener(_fecha: string): Promise<readonly TasaBcvCapturada[]> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(URL_BCV, { signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`BCV respondió ${resp.status}`);
      }
      return parsearTasasBcv(await resp.text());
    } finally {
      clearTimeout(t);
    }
  }
}
