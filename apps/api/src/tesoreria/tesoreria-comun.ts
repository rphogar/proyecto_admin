import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { accounts, periods } from '../db/schema';

/**
 * Helpers compartidos por los servicios de tesorería (P11). Centralizan lo que en P8/P9 estaba
 * duplicado por servicio: resolución del plan de cuentas (código↔id) y verificación de período
 * abierto (regla 9). Todo se ejecuta DENTRO de `withTenant` (RLS).
 */

/** Mapas código→id e id→código del plan de la empresa. */
export interface MapasCuentas {
  readonly porCodigo: Map<string, string>;
  readonly porId: Map<string, string>;
}

export async function cargarCuentas(tx: DatabaseTx, companyId: string): Promise<MapasCuentas> {
  const filas = await tx.select({ id: accounts.id, codigo: accounts.codigo }).from(accounts).where(eq(accounts.companyId, companyId));
  return {
    porCodigo: new Map(filas.map((f) => [f.codigo, f.id])),
    porId: new Map(filas.map((f) => [f.id, f.codigo])),
  };
}

/** Devuelve el id del período abierto `anio-mes` de la empresa, o lanza si no existe / está cerrado. */
export async function requerirPeriodoAbierto(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<string> {
  const [row] = await tx
    .select({ id: periods.id, estado: periods.estado })
    .from(periods)
    .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
    .limit(1);
  const etiqueta = `${anio}-${String(mes).padStart(2, '0')}`;
  if (row === undefined) {
    throw new BadRequestException(`No existe período contable ${etiqueta} para la empresa`);
  }
  if (row.estado === 'CLOSED') {
    throw new BadRequestException(`El período ${etiqueta} está cerrado (regla 9)`);
  }
  return row.id;
}

/** Hash de integridad sha256 de un objeto serializable (cadena inviolable, Providencia 121). */
export function hashIntegridad(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
