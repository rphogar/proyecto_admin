import { Injectable } from '@nestjs/common';
import {
  type EstadoFrescura,
  type TasaCambio,
  estadoFrescura,
  fechaFiscal,
} from '@contave/shared';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { exchangeRates } from '../db/schema';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import type { CrearTasaManualInput } from './dto';
import type { MonedaBcv } from './fuentes/fuente-bcv';

/** Fila de tasa expuesta por la API. */
export interface TasaDto {
  id: string;
  moneda: string;
  rate: string;
  rateDate: string;
  source: string;
  capturedAt: string;
}

/** Respuesta del widget "tasa del día": tasa aplicable + frescura para el banner (caso 57). */
export interface TasaDelDiaDto {
  moneda: string;
  fecha: string;
  rate: string | null;
  rateDate: string | null;
  source: string | null;
  frescura: EstadoFrescura;
}

type FilaExchangeRate = typeof exchangeRates.$inferSelect;

function aDto(fila: FilaExchangeRate): TasaDto {
  return {
    id: fila.id,
    moneda: fila.currency,
    rate: fila.rate,
    rateDate: fila.rateDate,
    source: fila.source,
    capturedAt: fila.capturedAt.toISOString(),
  };
}

function aTasaCambio(fila: FilaExchangeRate): TasaCambio {
  return {
    moneda: fila.currency,
    rate: fila.rate,
    rateDate: fila.rateDate,
    source: fila.source as TasaCambio['source'],
    capturedAt: fila.capturedAt,
  };
}

/**
 * Servicio de tasas (P4): resolución `rateForDb` (equivalente SQL de `rateFor`, regla "última
 * publicada anterior"), entrada manual auditada y consulta de historial. Todo bajo `withTenant`
 * (RLS mezcla las tasas globales BCV con las propias del tenant).
 */
@Injectable()
export class TasasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Tasa aplicable a `fecha` para `moneda`: la última con `rate_date <= fecha` (caso 1). */
  async rateForDb(moneda: MonedaBcv, fecha: string): Promise<FilaExchangeRate | null> {
    return withTenant(this.database.db, async (tx) => {
      const [fila] = await tx
        .select()
        .from(exchangeRates)
        .where(and(eq(exchangeRates.currency, moneda), lte(exchangeRates.rateDate, fecha)))
        .orderBy(desc(exchangeRates.rateDate), desc(exchangeRates.capturedAt))
        .limit(1);
      return fila ?? null;
    });
  }

  /** Tasa del día (default hoy en Caracas) + estado de frescura para el banner (caso 57). */
  async tasaDelDia(moneda: MonedaBcv, fecha?: string): Promise<TasaDelDiaDto> {
    const dia = fecha ?? fechaFiscal(new Date());
    const fila = await this.rateForDb(moneda, dia);
    return {
      moneda,
      fecha: dia,
      rate: fila?.rate ?? null,
      rateDate: fila?.rateDate ?? null,
      source: fila?.source ?? null,
      frescura: estadoFrescura(fila === null ? null : aTasaCambio(fila), dia),
    };
  }

  /** Historial de tasas de una moneda en un rango de fechas (para el widget de historial). */
  async historial(moneda: MonedaBcv, desde: string, hasta: string): Promise<TasaDto[]> {
    const filas = await withTenant(this.database.db, (tx) =>
      tx
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.currency, moneda),
            gte(exchangeRates.rateDate, desde),
            lte(exchangeRates.rateDate, hasta),
          ),
        )
        .orderBy(desc(exchangeRates.rateDate), desc(exchangeRates.capturedAt)),
    );
    return filas.map(aDto);
  }

  /**
   * Entrada MANUAL de tasa (caso 57 / corrección operativa): inserta una fila del tenant actual
   * y registra el evento en `audit_events` en la MISMA transacción (regla 5). Append-only: una
   * entrada errónea se corrige con otra entrada, nunca con UPDATE.
   */
  async crearManual(input: CrearTasaManualInput): Promise<TasaDto> {
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const [fila] = await tx
        .insert(exchangeRates)
        .values({
          tenantId: ctx.tenantId,
          currency: input.moneda,
          rate: input.rate,
          rateDate: input.rateDate,
          source: 'MANUAL',
          motivo: input.motivo,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (fila === undefined) {
        throw new Error('No se pudo insertar la tasa manual');
      }
      await this.audit.registrar(tx, {
        accion: 'tasa.manual.crear',
        entidad: 'exchange_rates',
        entidadId: fila.id,
        after: aDto(fila),
      });
      return aDto(fila);
    });
  }
}
