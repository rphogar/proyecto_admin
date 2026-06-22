import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal, fechaFiscal } from '@contave/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { exchangeRates } from '../db/schema';
import {
  FUENTE_FALLBACK,
  FUENTE_PRIMARIA,
  type FuenteTasaBcv,
  type TasaBcvCapturada,
} from './fuentes/fuente-bcv';

/** Resultado de una corrida de captura (para logs/endpoint/operación). */
export interface ResultadoCaptura {
  status: 'capturado' | 'sin_tasa';
  fecha: string;
  fuente: string | null;
  insertadas: number;
  correcciones: number;
}

function hashFuente(t: TasaBcvCapturada, fecha: string): string {
  return createHash('sha256').update(`BCV|${t.moneda}|${fecha}|${t.rate}`).digest('hex');
}

/**
 * Orquesta la captura diaria de tasas BCV (docs/05 §3.3, casos 3, 11, 57): intenta la fuente
 * primaria, cae al fallback, y si ambas fallan emite alerta y NO inserta (se sigue operando con
 * la última tasa, caso 57). Persiste las tasas como GLOBALES (`tenant_id = NULL`) en una tx sin
 * contexto de tenant — la policy de RLS admite `tenant_id IS NULL`. Es idempotente (caso 11):
 * re-capturar la misma tasa no inserta nada; una corrección del BCV (mismo día, rate distinto,
 * caso 3) entra como fila nueva con `reemplaza_a` y dispara alerta.
 */
@Injectable()
export class CapturaBcvService {
  private readonly logger = new Logger(CapturaBcvService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(FUENTE_PRIMARIA) private readonly primaria: FuenteTasaBcv,
    @Inject(FUENTE_FALLBACK) private readonly fallback: FuenteTasaBcv,
  ) {}

  async capturar(fecha: string = fechaFiscal(new Date())): Promise<ResultadoCaptura> {
    const obtenidas = await this.obtenerConFallback(fecha);
    if (obtenidas === null) {
      // Alerta operativa: el contador opera con la última tasa publicada (caso 57).
      this.logger.warn(`tasa.captura.fallo: sin tasa BCV para ${fecha} (primaria y fallback fallaron)`);
      return { status: 'sin_tasa', fecha, fuente: null, insertadas: 0, correcciones: 0 };
    }

    let insertadas = 0;
    let correcciones = 0;
    // Tx SIN contexto de tenant: app_current_tenant() = NULL ⇒ solo pasa `tenant_id IS NULL`.
    await this.database.db.transaction(async (tx) => {
      for (const tasa of obtenidas.tasas) {
        const r = await this.persistirTasa(tx, fecha, tasa);
        if (r === 'insertada') insertadas += 1;
        else if (r === 'correccion') correcciones += 1;
      }
    });
    return { status: 'capturado', fecha, fuente: obtenidas.fuente, insertadas, correcciones };
  }

  private async obtenerConFallback(
    fecha: string,
  ): Promise<{ tasas: readonly TasaBcvCapturada[]; fuente: string } | null> {
    for (const fuente of [this.primaria, this.fallback]) {
      try {
        const tasas = await fuente.obtener(fecha);
        if (tasas.length > 0) return { tasas, fuente: fuente.nombre };
        this.logger.warn(`${fuente.nombre}: respuesta vacía para ${fecha}`);
      } catch (err) {
        this.logger.warn(`${fuente.nombre}: fallo al capturar ${fecha}: ${(err as Error).message}`);
      }
    }
    return null;
  }

  private async persistirTasa(
    tx: DatabaseTx,
    fecha: string,
    tasa: TasaBcvCapturada,
  ): Promise<'insertada' | 'correccion' | 'duplicada'> {
    const existentes = await tx
      .select({ id: exchangeRates.id, rate: exchangeRates.rate })
      .from(exchangeRates)
      .where(
        and(
          isNull(exchangeRates.tenantId),
          eq(exchangeRates.currency, tasa.moneda),
          eq(exchangeRates.rateDate, fecha),
          eq(exchangeRates.source, 'BCV'),
        ),
      )
      .orderBy(desc(exchangeRates.capturedAt));

    // Idempotencia (caso 11): si ya existe esta misma tasa para el día, no se hace nada. La
    // comparación es NUMÉRICA: la BD devuelve NUMERIC(20,8) con ceros de escala ("612.43320000")
    // y el parser entrega el valor sin ceros sobrantes ("612.4332"); un `===` de strings los vería
    // distintos y rompería contra el índice único de idempotencia.
    if (existentes.some((e) => new Decimal(e.rate).eq(tasa.rate))) return 'duplicada';

    // `existentes` viene ordenado por captured_at DESC: la primera es la vigente a corregir.
    const previa = existentes[0] ?? null;
    await tx.insert(exchangeRates).values({
      tenantId: null,
      currency: tasa.moneda,
      rate: tasa.rate,
      rateDate: fecha,
      source: 'BCV',
      publishedAt: tasa.publishedAt,
      hashFuente: hashFuente(tasa, fecha),
      reemplazaA: previa?.id ?? null,
    });

    if (previa !== null) {
      // Caso 3: el BCV corrigió una tasa ya publicada. La original NO se toca; alerta al contador.
      this.logger.warn(
        `tasa.corregida: ${tasa.moneda} ${fecha} ${previa.rate} → ${tasa.rate} (fila nueva)`,
      );
      return 'correccion';
    }
    return 'insertada';
  }
}
