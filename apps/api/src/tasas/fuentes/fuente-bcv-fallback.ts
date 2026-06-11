import { Injectable } from '@nestjs/common';
import type { FuenteTasaBcv, TasaBcvCapturada } from './fuente-bcv';
import { parsearTasasBcv } from './parser-bcv';

const URL_FALLBACK = process.env.TASAS_BCV_FALLBACK_URL ?? '';
const TIMEOUT_MS = Number(process.env.TASAS_BCV_TIMEOUT_MS ?? 15_000);

/**
 * Fuente de FALLBACK: un espejo/caché del HTML del BCV configurado por `TASAS_BCV_FALLBACK_URL`
 * (mismo marcado → reutiliza `parsearTasasBcv`). Si no hay URL configurada, lanza para que la
 * orquestación caiga a "sin tasa" y siga operando con la última publicada (caso 57).
 *
 * // TODO: si se adopta una API JSON (p.ej. un agregador), apuntar la env a un proxy que
 * // entregue el mismo HTML, o añadir aquí un parser JSON detrás de la misma interfaz.
 */
@Injectable()
export class FuenteBcvFallback implements FuenteTasaBcv {
  readonly nombre = 'BCV-fallback';

  async obtener(_fecha: string): Promise<readonly TasaBcvCapturada[]> {
    if (URL_FALLBACK === '') {
      throw new Error('Sin fuente de fallback configurada (TASAS_BCV_FALLBACK_URL)');
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(URL_FALLBACK, { signal: controller.signal });
      if (!resp.ok) {
        throw new Error(`Fallback respondió ${resp.status}`);
      }
      return parsearTasasBcv(await resp.text());
    } finally {
      clearTimeout(t);
    }
  }
}
