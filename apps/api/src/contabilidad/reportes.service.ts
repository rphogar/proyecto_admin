import { BadRequestException, Injectable } from '@nestjs/common';
import {
  balanceDeComprobacionDesdeMovimientos,
  estadoDeResultados,
  estadoDeSituacion,
  type NodoEstado,
} from '@contave/ledger';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, journalEntries, journalLines, periods } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, requireString, requireUuid } from '../maestros/validacion';
import { withTenant } from '../tenant/with-tenant';
import { movimientosPorCuenta, type RangoPeriodo } from './agregacion-saldos';
import { type ClaveMes, cargarPlan, ordinalMes } from './contabilidad-comun';

/**
 * Reportes contables (P13, docs/03 §6): balance de comprobación doble base y estados financieros
 * (Situación + Resultados) en VES fiscal y USD gerencial, con drill-down al documento origen. La
 * agregación la hace SQL (`movimientosPorCuenta`) y el armado contable las funciones puras del
 * ledger. Los montos se serializan a string con precisión completa (la UI redondea en presentación).
 */

interface FilaBalanceDTO {
  cuenta: string;
  naturaleza?: string;
  debeVes: string;
  haberVes: string;
  saldoDeudorVes: string;
  debeUsd: string;
  haberUsd: string;
  saldoDeudorUsd: string;
}
export interface BalanceComprobacionDTO {
  filas: FilaBalanceDTO[];
  totalDebeVes: string;
  totalHaberVes: string;
  totalDebeUsd: string;
  totalHaberUsd: string;
  cuadraVes: boolean;
  cuadraUsd: boolean;
}

interface NodoEstadoDTO {
  cuenta: string;
  nombre: string;
  nivel: number;
  naturaleza: string;
  esMovimiento: boolean;
  saldoVes: string;
  saldoUsd: string;
  hijos: NodoEstadoDTO[];
}
export interface EstadoResultadosDTO {
  ingresos: NodoEstadoDTO[];
  costos: NodoEstadoDTO[];
  gastos: NodoEstadoDTO[];
  totalIngresosVes: string;
  totalGastosVes: string;
  totalCostosVes: string;
  utilidadVes: string;
  utilidadUsd: string;
}
export interface EstadoSituacionDTO {
  activo: NodoEstadoDTO[];
  pasivo: NodoEstadoDTO[];
  patrimonio: NodoEstadoDTO[];
  totalActivoVes: string;
  totalPasivoVes: string;
  totalPatrimonioVes: string;
  resultadoDelPeriodoVes: string;
  resultadoDelPeriodoUsd: string;
  cuadraVes: boolean;
  cuadraUsd: boolean;
}

export interface MovimientoFuente {
  entryId: string;
  fecha: Date;
  descripcion: string;
  sourceType: string | null;
  sourceId: string | null;
  dc: string;
  montoVes: string;
  montoUsdMgmt: string;
}

@Injectable()
export class ReportesService {
  constructor(private readonly database: DatabaseService) {}

  async balanceComprobacion(query: unknown): Promise<BalanceComprobacionDTO> {
    const { companyId, rango } = parseConsulta(query);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const plan = await cargarPlan(tx, companyId);
      const movs = await movimientosPorCuenta(tx, companyId, rango);
      const bc = balanceDeComprobacionDesdeMovimientos(movs, { plan });
      return {
        filas: bc.filas.map((f) => ({
          cuenta: f.cuenta,
          ...(f.naturaleza !== undefined ? { naturaleza: f.naturaleza } : {}),
          debeVes: f.debeVes.aCadenaDecimal(),
          haberVes: f.haberVes.aCadenaDecimal(),
          saldoDeudorVes: f.saldoDeudorVes.aCadenaDecimal(),
          debeUsd: f.debeUsd.aCadenaDecimal(),
          haberUsd: f.haberUsd.aCadenaDecimal(),
          saldoDeudorUsd: f.saldoDeudorUsd.aCadenaDecimal(),
        })),
        totalDebeVes: bc.totalDebeVes.aCadenaDecimal(),
        totalHaberVes: bc.totalHaberVes.aCadenaDecimal(),
        totalDebeUsd: bc.totalDebeUsd.aCadenaDecimal(),
        totalHaberUsd: bc.totalHaberUsd.aCadenaDecimal(),
        cuadraVes: bc.cuadraVes,
        cuadraUsd: bc.cuadraUsd,
      };
    });
  }

  async estadoResultados(query: unknown): Promise<EstadoResultadosDTO> {
    const { companyId, rango } = parseConsulta(query);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const plan = await cargarPlan(tx, companyId);
      const movs = await movimientosPorCuenta(tx, companyId, rango);
      const er = estadoDeResultados(movs, plan);
      return {
        ingresos: er.ingresos.map(nodoDTO),
        costos: er.costos.map(nodoDTO),
        gastos: er.gastos.map(nodoDTO),
        totalIngresosVes: er.totalIngresosVes.aCadenaDecimal(),
        totalCostosVes: er.totalCostosVes.aCadenaDecimal(),
        totalGastosVes: er.totalGastosVes.aCadenaDecimal(),
        utilidadVes: er.utilidadVes.aCadenaDecimal(),
        utilidadUsd: er.utilidadUsd.aCadenaDecimal(),
      };
    });
  }

  async estadoSituacion(query: unknown): Promise<EstadoSituacionDTO> {
    const b = asRecord(query);
    const companyId = requireUuid(b.companyId, 'companyId');
    const hasta = parseClave(b, 'hasta');
    // Balance general: saldos acumulados desde el inicio hasta el corte (sin `desde`).
    const rango: RangoPeriodo = { hasta };
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const plan = await cargarPlan(tx, companyId);
      const movs = await movimientosPorCuenta(tx, companyId, rango);
      const er = estadoDeResultados(movs, plan);
      const es = estadoDeSituacion(movs, plan, { ves: er.utilidadVes, usd: er.utilidadUsd });
      return {
        activo: es.activo.map(nodoDTO),
        pasivo: es.pasivo.map(nodoDTO),
        patrimonio: es.patrimonio.map(nodoDTO),
        totalActivoVes: es.totalActivoVes.aCadenaDecimal(),
        totalPasivoVes: es.totalPasivoVes.aCadenaDecimal(),
        totalPatrimonioVes: es.totalPatrimonioVes.aCadenaDecimal(),
        resultadoDelPeriodoVes: es.resultadoDelPeriodoVes.aCadenaDecimal(),
        resultadoDelPeriodoUsd: es.resultadoDelPeriodoUsd.aCadenaDecimal(),
        cuadraVes: es.cuadraVes,
        cuadraUsd: es.cuadraUsd,
      };
    });
  }

  /** Drill-down: movimientos POSTED de una cuenta en el rango, con su documento origen. */
  async drillDown(query: unknown): Promise<MovimientoFuente[]> {
    const b = asRecord(query);
    const companyId = requireUuid(b.companyId, 'companyId');
    const cuenta = requireString(b.cuenta, 'cuenta', 60);
    const rango = parseRango(b);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return movimientosFuente(tx, companyId, cuenta, rango);
    });
  }
}

// ── Serialización ───────────────────────────────────────────────────────────

function nodoDTO(n: NodoEstado): NodoEstadoDTO {
  return {
    cuenta: n.cuenta,
    nombre: n.nombre,
    nivel: n.nivel,
    naturaleza: n.naturaleza,
    esMovimiento: n.esMovimiento,
    saldoVes: n.saldoVes.aCadenaDecimal(),
    saldoUsd: n.saldoUsd.aCadenaDecimal(),
    hijos: n.hijos.map(nodoDTO),
  };
}

// ── Parseo de consulta ─────────────────────────────────────────────────────

function parseConsulta(query: unknown): { companyId: string; rango: RangoPeriodo } {
  const b = asRecord(query);
  return { companyId: requireUuid(b.companyId, 'companyId'), rango: parseRango(b) };
}

function parseRango(b: Record<string, unknown>): RangoPeriodo {
  const hasta = parseClave(b, 'hasta');
  const desde = b.desdeAnio !== undefined || b.desdeMes !== undefined ? parseClavePrefijo(b, 'desde') : null;
  if (desde !== null && ordinalMes(desde) > ordinalMes(hasta)) {
    throw new BadRequestException('El período "desde" no puede ser posterior a "hasta"');
  }
  return desde !== null ? { desde, hasta } : { hasta };
}

function parseClave(b: Record<string, unknown>, prefijo: string): ClaveMes {
  return parseClavePrefijo(b, prefijo);
}

function parseClavePrefijo(b: Record<string, unknown>, prefijo: string): ClaveMes {
  const anio = optionalInt(b[`${prefijo}Anio`], `${prefijo}Anio`, 0, 2000);
  const mes = optionalInt(b[`${prefijo}Mes`], `${prefijo}Mes`, 0, 1);
  if (anio < 2000 || mes < 1 || mes > 12) throw new BadRequestException(`${prefijo}Anio/${prefijo}Mes inválidos`);
  return { anio, mes };
}

async function movimientosFuente(tx: DatabaseTx, companyId: string, cuenta: string, rango: RangoPeriodo): Promise<MovimientoFuente[]> {
  const ord = sql`(${periods.anio} * 12 + ${periods.mes} - 1)`;
  const condiciones = [
    eq(journalLines.companyId, companyId),
    eq(accounts.codigo, cuenta),
    eq(journalEntries.estado, 'POSTED'),
    sql`${ord} <= ${ordinalMes(rango.hasta)}`,
  ];
  if (rango.desde != null) condiciones.push(sql`${ord} >= ${ordinalMes(rango.desde)}`);

  const filas = await tx
    .select({
      entryId: journalEntries.id,
      fecha: journalEntries.fecha,
      descripcion: journalEntries.descripcion,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      dc: journalLines.dc,
      montoVes: journalLines.montoVes,
      montoUsdMgmt: journalLines.montoUsdMgmt,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(periods, eq(journalEntries.periodId, periods.id))
    .where(and(...condiciones))
    .orderBy(asc(journalEntries.fecha));

  return filas.map((f) => ({
    entryId: f.entryId,
    fecha: f.fecha,
    descripcion: f.descripcion,
    sourceType: f.sourceType,
    sourceId: f.sourceId,
    dc: f.dc,
    montoVes: f.montoVes,
    montoUsdMgmt: f.montoUsdMgmt,
  }));
}
