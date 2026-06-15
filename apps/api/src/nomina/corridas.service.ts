import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  calcularReciboNomina,
  type ConceptoNomina,
  derivarSalarios,
  resolverSalarioNormalMensual,
} from '@contave/fiscal-engine';
import { Asiento, type EntradaLinea, postear } from '@contave/ledger';
import { caracasAUtc, Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, nominaConceptos, nominaCorridas, nominaReciboLineas, nominaRecibos, nominaTrabajadores } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireDecimal, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarCuentas, cargarParametrosNomina, requerirPeriodoAbierto } from './nomina-comun';

export type Corrida = typeof nominaCorridas.$inferSelect;
export type Recibo = typeof nominaRecibos.$inferSelect;
export type ReciboLinea = typeof nominaReciboLineas.$inferSelect;

export interface CorridaConRecibos {
  readonly corrida: Corrida;
  readonly recibos: ReadonlyArray<Recibo & { lineas: ReciboLinea[] }>;
}

const MS_DIA = 86_400_000;
const FRECUENCIAS = ['SEMANAL', 'QUINCENAL', 'MENSUAL'] as const;

/**
 * Corridas de nómina (P15, docs/04 §5): pre-nómina → aprobación → contabilización. `crear` calcula
 * los recibos de todos los trabajadores activos en el período con el motor puro (`derivarSalarios` +
 * `calcularReciboNomina` con fórmulas seguras) y los deja en BORRADOR. `aprobar` congela los recibos
 * (inmutables por trigger). `contabilizar` postea el asiento (gasto 6.1 contra sueldos por pagar
 * 2.4.01 y retenciones por enterar 2.4.06) en triple base y enlaza el `journal_entry_id`.
 */
@Injectable()
export class CorridasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async crear(body: unknown): Promise<CorridaConRecibos> {
    const e = parse(body);
    const rate = new Decimal(e.rateBcv);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new BadRequestException(`Empresa ${e.companyId} no encontrada`);

      const existente = await tx
        .select({ id: nominaCorridas.id })
        .from(nominaCorridas)
        .where(and(eq(nominaCorridas.companyId, e.companyId), eq(nominaCorridas.periodoEtiqueta, e.periodoEtiqueta)))
        .limit(1);
      if (existente.length > 0) {
        throw new BadRequestException(`Ya existe una corrida para el período ${e.periodoEtiqueta}`);
      }

      const params = await cargarParametrosNomina(tx, fechaFiscal(e.fechaFin));
      const conceptos = await tx.select().from(nominaConceptos).where(and(eq(nominaConceptos.companyId, e.companyId), eq(nominaConceptos.activo, true))).orderBy(nominaConceptos.orden);
      if (conceptos.length === 0) throw new BadRequestException('La empresa no tiene conceptos de nómina activos');
      const trabajadores = await tx.select().from(nominaTrabajadores).where(and(eq(nominaTrabajadores.companyId, e.companyId), eq(nominaTrabajadores.activo, true)));

      const diasPeriodo = Math.round((e.fechaFin.getTime() - e.fechaInicio.getTime()) / MS_DIA) + 1;

      const corridaId = randomUUID();
      const conceptosEngine: ConceptoNomina[] = conceptos.map((c) => ({
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo as ConceptoNomina['tipo'],
        formula: c.formula,
        salarial: c.salarial,
      }));

      let totalAsig = new Decimal(0);
      let totalDed = new Decimal(0);
      let totalNeto = new Decimal(0);
      const recibosOut: Array<Recibo & { lineas: ReciboLinea[] }> = [];

      for (const t of trabajadores) {
        const dias = diasEfectivos(e.fechaInicio, e.fechaFin, t.fechaIngreso, t.fechaEgreso);
        if (dias <= 0) continue; // no laboró en el período

        const normalMensual = resolverSalarioNormalMensual([
          { moneda: 'VES', monto: t.salarioNormalMensual },
          ...(t.salarioMonedaExtra && t.salarioMontoExtra ? [{ moneda: t.salarioMonedaExtra, monto: t.salarioMontoExtra, rate: e.rateBcv }] : []),
        ]);
        const sal = derivarSalarios({
          salarioNormalMensual: normalMensual,
          diasUtilidades: t.diasUtilidades ?? company.diasUtilidades ?? 30,
          diasBonoVacacional: t.diasBonoVacacional ?? 15,
        });

        const scope = {
          salario_normal: normalMensual,
          salario_integral: sal.salarioIntegralMensual,
          salario_diario: sal.salarioDiario,
          salario_diario_integral: sal.salarioDiarioIntegral,
          dias,
          dias_periodo: diasPeriodo,
          dias_cestaticket: dias,
          salario_minimo: params.salarioMinimoMensual,
          ut: params.ut,
          cestaticket: params.cestaticketMensual,
          cestaticket_diario: new Decimal(params.cestaticketMensual).div(30).toFixed(8),
          ari_porcentaje: t.ariPorcentaje,
        };

        const recibo = calcularReciboNomina({ conceptos: conceptosEngine, scope });

        const reciboId = randomUUID();
        const neto = new Decimal(recibo.neto);
        await tx.insert(nominaRecibos).values({
          id: reciboId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          corridaId,
          trabajadorId: t.id,
          diasEfectivos: String(dias),
          salarioDiario: sal.salarioDiario,
          salarioDiarioIntegral: sal.salarioDiarioIntegral,
          totalAsignaciones: recibo.totalAsignaciones,
          totalDeducciones: recibo.totalDeducciones,
          neto: recibo.neto,
          netoUsd: neto.div(rate).toFixed(8),
          rateBcv: e.rateBcv,
        });

        const lineasFilas = recibo.lineas.map((l, i) => ({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          reciboId,
          conceptoCodigo: l.codigo,
          nombre: l.nombre,
          tipo: l.tipo,
          salarial: l.salarial,
          moneda: 'VES',
          montoOrigen: l.monto,
          montoVes: l.monto,
          montoUsdMgmt: new Decimal(l.monto).div(rate).toFixed(8),
          rateBcv: e.rateBcv,
          rateUsdMgmt: e.rateBcv,
          orden: i + 1,
        }));
        const lineas = await tx.insert(nominaReciboLineas).values(lineasFilas).returning();

        totalAsig = totalAsig.plus(recibo.totalAsignaciones);
        totalDed = totalDed.plus(recibo.totalDeducciones);
        totalNeto = totalNeto.plus(recibo.neto);

        const [reciboRow] = await tx.select().from(nominaRecibos).where(eq(nominaRecibos.id, reciboId)).limit(1);
        if (reciboRow !== undefined) recibosOut.push({ ...reciboRow, lineas });
      }

      if (recibosOut.length === 0) throw new BadRequestException('Ningún trabajador activo laboró en el período indicado');

      const [corrida] = await tx
        .insert(nominaCorridas)
        .values({
          id: corridaId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          anio: e.anio,
          mes: e.mes,
          periodoEtiqueta: e.periodoEtiqueta,
          frecuencia: e.frecuencia,
          fechaInicio: e.fechaInicio,
          fechaFin: e.fechaFin,
          estado: 'BORRADOR',
          totalAsignaciones: totalAsig.toFixed(8),
          totalDeducciones: totalDed.toFixed(8),
          totalNeto: totalNeto.toFixed(8),
          totalAportesPatronales: '0',
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (corrida === undefined) throw new Error('No se pudo crear la corrida');

      await this.audit.registrar(tx, { accion: 'nomina.corrida_crear', entidad: 'nomina_corridas', entidadId: corridaId, after: corrida });
      return { corrida, recibos: recibosOut };
    });
  }

  async aprobar(body: unknown): Promise<Corrida> {
    const b = asRecord(body);
    const id = requireUuid(b.id, 'id');
    const companyId = requireUuid(b.companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const corrida = await this.corridaDe(tx, id, companyId);
      if (corrida.estado !== 'BORRADOR') throw new BadRequestException(`La corrida está en estado ${corrida.estado}; solo se aprueba una BORRADOR`);
      const [fila] = await tx
        .update(nominaCorridas)
        .set({ estado: 'APROBADA', aprobadaPor: ctx.userId ?? null, aprobadaEn: new Date() })
        .where(eq(nominaCorridas.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo aprobar la corrida');
      await this.audit.registrar(tx, { accion: 'nomina.corrida_aprobar', entidad: 'nomina_corridas', entidadId: id, before: corrida, after: fila });
      return fila;
    });
  }

  async contabilizar(body: unknown): Promise<Corrida> {
    const b = asRecord(body);
    const id = requireUuid(b.id, 'id');
    const companyId = requireUuid(b.companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const corrida = await this.corridaDe(tx, id, companyId);
      if (corrida.estado !== 'APROBADA') throw new BadRequestException(`La corrida está en estado ${corrida.estado}; solo se contabiliza una APROBADA`);

      const { porCodigo } = await cargarCuentas(tx, companyId);
      const { anio, mes } = periodoFiscal(corrida.fechaFin);
      const periodId = await requerirPeriodoAbierto(tx, companyId, anio, mes);

      const asignaciones = new Decimal(corrida.totalAsignaciones);
      const neto = new Decimal(corrida.totalNeto);
      const deducciones = asignaciones.minus(neto); // = total deducciones, fuerza el cuadre exacto
      const [unRecibo] = await tx.select({ rateBcv: nominaRecibos.rateBcv }).from(nominaRecibos).where(eq(nominaRecibos.corridaId, id)).limit(1);
      const rateUsd = new Decimal(unRecibo?.rateBcv ?? '1');

      const usd = (ves: Decimal): string => ves.div(rateUsd).toFixed(8);
      const lineas: EntradaLinea[] = [
        // Gasto de personal (6.1) por el total devengado.
        { cuenta: '6.1', dc: 'D', moneda: 'VES', montoOrigen: asignaciones.toFixed(8), montoVes: asignaciones.toFixed(8), montoUsdMgmt: usd(asignaciones), rateBcv: rateUsd.toFixed(), rateUsdMgmt: rateUsd.toFixed() },
        // Sueldos por pagar (2.4.01) por el neto.
        { cuenta: '2.4.01', dc: 'C', moneda: 'VES', montoOrigen: neto.toFixed(8), montoVes: neto.toFixed(8), montoUsdMgmt: usd(neto), rateBcv: rateUsd.toFixed(), rateUsdMgmt: rateUsd.toFixed() },
      ];
      // Retenciones al trabajador por enterar (2.4.06) — TODO: desglosar por concepto→cuenta (ISLR a 2.4.09).
      if (deducciones.gt(0)) {
        const usdDed = asignaciones.div(rateUsd).minus(neto.div(rateUsd)).toFixed(8);
        lineas.push({ cuenta: '2.4.06', dc: 'C', moneda: 'VES', montoOrigen: deducciones.toFixed(8), montoVes: deducciones.toFixed(8), montoUsdMgmt: usdDed, rateBcv: rateUsd.toFixed(), rateUsdMgmt: rateUsd.toFixed() });
      }

      const entryId = randomUUID();
      const asiento = postear(
        Asiento.construir({ id: entryId, companyId, fecha: corrida.fechaFin, descripcion: `Nómina ${corrida.periodoEtiqueta}`, lineas, sourceType: 'NOMINA', sourceId: id }),
      );
      await persistirAsiento(tx, asiento, { tenantId: ctx.tenantId, companyId, periodId, createdBy: ctx.userId ?? null, cuentas: porCodigo });

      const [fila] = await tx
        .update(nominaCorridas)
        .set({ estado: 'CONTABILIZADA', journalEntryId: entryId, contabilizadaEn: new Date() })
        .where(eq(nominaCorridas.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo contabilizar la corrida');
      await this.audit.registrar(tx, { accion: 'nomina.corrida_contabilizar', entidad: 'nomina_corridas', entidadId: id, before: corrida, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<Corrida[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaCorridas).where(eq(nominaCorridas.companyId, cid));
    });
  }

  async obtener(id: string, companyId: string): Promise<CorridaConRecibos> {
    const cid = requireUuid(companyId, 'companyId');
    const corridaId = requireUuid(id, 'id');
    return withTenant(this.database.db, async (tx) => {
      const corrida = await this.corridaDe(tx, corridaId, cid);
      const recibos = await tx.select().from(nominaRecibos).where(eq(nominaRecibos.corridaId, corridaId));
      const out = [];
      for (const r of recibos) {
        const lineas = await tx.select().from(nominaReciboLineas).where(eq(nominaReciboLineas.reciboId, r.id)).orderBy(nominaReciboLineas.orden);
        out.push({ ...r, lineas });
      }
      return { corrida, recibos: out };
    });
  }

  private async corridaDe(tx: DatabaseTx, id: string, companyId: string): Promise<Corrida> {
    const [fila] = await tx.select().from(nominaCorridas).where(and(eq(nominaCorridas.id, id), eq(nominaCorridas.companyId, companyId))).limit(1);
    if (fila === undefined) throw new BadRequestException(`La corrida ${id} no existe en la empresa`);
    return fila;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface CorridaInput {
  companyId: string;
  anio: number;
  mes: number;
  periodoEtiqueta: string;
  frecuencia: (typeof FRECUENCIAS)[number];
  fechaInicio: Date;
  fechaFin: Date;
  rateBcv: string;
}

function parse(body: unknown): CorridaInput {
  const b = asRecord(body);
  const inicio = requireString(b.fechaInicio, 'fechaInicio', 10);
  const fin = requireString(b.fechaFin, 'fechaFin', 10);
  const anio = Number(b.anio);
  const mes = Number(b.mes);
  if (!Number.isInteger(anio) || anio < 2000) throw new BadRequestException('anio inválido');
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('mes inválido');
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    anio,
    mes,
    periodoEtiqueta: optionalString(b.periodoEtiqueta, 'periodoEtiqueta', 40) ?? `${anio}-${String(mes).padStart(2, '0')}`,
    frecuencia: requireEnum(b.frecuencia, 'frecuencia', FRECUENCIAS, (s) => s.toUpperCase()),
    fechaInicio: caracasAUtc(inicio),
    fechaFin: caracasAUtc(fin),
    rateBcv: requireDecimal(b.rateBcv, 'rateBcv'),
  };
}

/** Días efectivos del trabajador dentro del período (prorrateo por ingreso/egreso — casos 47, 52). */
function diasEfectivos(inicio: Date, fin: Date, fechaIngreso: string, fechaEgreso: string | null): number {
  const ingreso = caracasAUtc(fechaIngreso).getTime();
  const egreso = fechaEgreso ? caracasAUtc(fechaEgreso).getTime() : fin.getTime();
  const desde = Math.max(inicio.getTime(), ingreso);
  const hasta = Math.min(fin.getTime(), egreso);
  if (hasta < desde) return 0;
  return Math.round((hasta - desde) / MS_DIA) + 1;
}
