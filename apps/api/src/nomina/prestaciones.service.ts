import { Injectable } from '@nestjs/common';
import { calcularPrestacionesArt142, type ResultadoPrestacionesArt142 } from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { nominaPrestacionesKardex, nominaTrabajadores } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalDecimal, optionalString, requireDecimal, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type MovimientoKardex = typeof nominaPrestacionesKardex.$inferSelect;

const TIPOS = ['DEPOSITO_TRIMESTRAL', 'DIAS_ADICIONALES', 'INTERES', 'ADELANTO', 'LIQUIDACION'] as const;
/** Tipos que suman a la garantía; ADELANTO y LIQUIDACION la reducen. */
const SUMAN = new Set(['DEPOSITO_TRIMESTRAL', 'DIAS_ADICIONALES', 'INTERES']);

export interface ResultadoLiquidacion {
  readonly calculo: ResultadoPrestacionesArt142;
  readonly movimiento: MovimientoKardex;
}

/**
 * Kardex de prestaciones y liquidación (P15, docs/04 §2.3, art. 142). El kardex es append-only
 * (trigger en 0046): cada depósito trimestral, día adicional, interés, anticipo o liquidación es un
 * movimiento inmutable, fuente de la vía "garantía" del doble cálculo. `liquidar` calcula el monto
 * a pagar (mayor entre garantía y retroactivo, menos anticipos, más art. 92) con el motor puro y
 * registra el movimiento de LIQUIDACION. Bajo RLS y auditado.
 */
@Injectable()
export class PrestacionesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async registrar(body: unknown): Promise<MovimientoKardex> {
    const e = parseMovimiento(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const saldoPrev = await saldoGarantia(tx, e.companyId, e.trabajadorId);
      const delta = SUMAN.has(e.tipo) ? new Decimal(e.montoVes) : new Decimal(e.montoVes).negated();
      const saldo = saldoPrev.plus(delta);
      const [fila] = await tx
        .insert(nominaPrestacionesKardex)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          trabajadorId: e.trabajadorId,
          fecha: e.fecha,
          tipo: e.tipo,
          diasIntegral: e.diasIntegral,
          salarioIntegralDiario: e.salarioIntegralDiario,
          montoVes: e.montoVes,
          montoUsd: e.montoUsd,
          saldoGarantiaVes: saldo.toFixed(8),
          nota: e.nota,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo registrar el movimiento de prestaciones');
      await this.audit.registrar(tx, { accion: 'nomina.prestaciones_movimiento', entidad: 'nomina_prestaciones_kardex', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async kardex(companyId: string, trabajadorId: string): Promise<MovimientoKardex[]> {
    const cid = requireUuid(companyId, 'companyId');
    const tid = requireUuid(trabajadorId, 'trabajadorId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaPrestacionesKardex).where(and(eq(nominaPrestacionesKardex.companyId, cid), eq(nominaPrestacionesKardex.trabajadorId, tid))).orderBy(nominaPrestacionesKardex.fecha);
    });
  }

  async liquidar(body: unknown): Promise<ResultadoLiquidacion> {
    const e = parseLiquidacion(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [trabajador] = await tx.select().from(nominaTrabajadores).where(and(eq(nominaTrabajadores.id, e.trabajadorId), eq(nominaTrabajadores.companyId, e.companyId))).limit(1);
      if (trabajador === undefined) throw new Error(`El trabajador ${e.trabajadorId} no existe en la empresa`);

      const movs = await tx.select().from(nominaPrestacionesKardex).where(and(eq(nominaPrestacionesKardex.companyId, e.companyId), eq(nominaPrestacionesKardex.trabajadorId, e.trabajadorId)));
      const sumar = (tipo: string): Decimal => movs.filter((m) => m.tipo === tipo).reduce((acc, m) => acc.plus(m.montoVes), new Decimal(0));

      const calculo = calcularPrestacionesArt142({
        garantiaAbonada: sumar('DEPOSITO_TRIMESTRAL').toFixed(8),
        diasAdicionalesAbonados: sumar('DIAS_ADICIONALES').toFixed(8),
        interesesAcumulados: e.interesesAcumulados ?? sumar('INTERES').toFixed(8),
        antiguedadAnios: e.antiguedadAnios,
        salarioIntegralDiarioFinal: e.salarioIntegralDiarioFinal,
        adelantos: e.adelantos ?? sumar('ADELANTO').toFixed(8),
        despidoInjustificado: e.despidoInjustificado,
      });

      const saldoPrev = await saldoGarantia(tx, e.companyId, e.trabajadorId);
      // TODO: el asiento de pago del finiquito (D 2.4.02/2.4.03 contra banco/sueldos por pagar) se
      // registra al pagar vía tesorería; aquí se cierra el kardex con el movimiento de LIQUIDACION.
      const [movimiento] = await tx
        .insert(nominaPrestacionesKardex)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          trabajadorId: e.trabajadorId,
          fecha: new Date(),
          tipo: 'LIQUIDACION',
          salarioIntegralDiario: e.salarioIntegralDiarioFinal,
          montoVes: calculo.totalAPagar,
          saldoGarantiaVes: saldoPrev.minus(calculo.totalAPagar).toFixed(8),
          nota: `Liquidación art. 142 (${calculo.baseMayor})`,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (movimiento === undefined) throw new Error('No se pudo registrar la liquidación');
      await this.audit.registrar(tx, { accion: 'nomina.prestaciones_liquidar', entidad: 'nomina_prestaciones_kardex', entidadId: movimiento.id, after: { calculo, movimiento } });
      return { calculo, movimiento };
    });
  }
}

async function saldoGarantia(tx: DatabaseTx, companyId: string, trabajadorId: string): Promise<Decimal> {
  const movs = await tx.select({ tipo: nominaPrestacionesKardex.tipo, montoVes: nominaPrestacionesKardex.montoVes }).from(nominaPrestacionesKardex).where(and(eq(nominaPrestacionesKardex.companyId, companyId), eq(nominaPrestacionesKardex.trabajadorId, trabajadorId)));
  return movs.reduce((acc, m) => (SUMAN.has(m.tipo) ? acc.plus(m.montoVes) : acc.minus(m.montoVes)), new Decimal(0));
}

interface MovimientoInput {
  companyId: string;
  trabajadorId: string;
  fecha: Date;
  tipo: (typeof TIPOS)[number];
  diasIntegral: string | null;
  salarioIntegralDiario: string | null;
  montoVes: string;
  montoUsd: string | null;
  nota: string | null;
}

function parseMovimiento(body: unknown): MovimientoInput {
  const b = asRecord(body);
  const fecha = b.fecha == null || String(b.fecha).trim() === '' ? new Date() : new Date(String(b.fecha));
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    trabajadorId: requireUuid(b.trabajadorId, 'trabajadorId'),
    fecha,
    tipo: requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toUpperCase()),
    diasIntegral: optionalDecimal(b.diasIntegral, 'diasIntegral'),
    salarioIntegralDiario: optionalDecimal(b.salarioIntegralDiario, 'salarioIntegralDiario'),
    montoVes: requireDecimal(b.montoVes, 'montoVes', true),
    montoUsd: optionalDecimal(b.montoUsd, 'montoUsd'),
    nota: optionalString(b.nota, 'nota', 300),
  };
}

interface LiquidacionInput {
  companyId: string;
  trabajadorId: string;
  antiguedadAnios: string;
  salarioIntegralDiarioFinal: string;
  adelantos: string | null;
  interesesAcumulados: string | null;
  despidoInjustificado: boolean;
}

function parseLiquidacion(body: unknown): LiquidacionInput {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    trabajadorId: requireUuid(b.trabajadorId, 'trabajadorId'),
    antiguedadAnios: requireString(b.antiguedadAnios, 'antiguedadAnios', 12),
    salarioIntegralDiarioFinal: requireDecimal(b.salarioIntegralDiarioFinal, 'salarioIntegralDiarioFinal'),
    adelantos: optionalDecimal(b.adelantos, 'adelantos'),
    interesesAcumulados: optionalDecimal(b.interesesAcumulados, 'interesesAcumulados'),
    despidoInjustificado: b.despidoInjustificado === true,
  };
}
