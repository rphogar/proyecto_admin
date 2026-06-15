import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { calcularProvisionesMes, derivarSalarios } from '@contave/fiscal-engine';
import { Asiento, type EntradaLinea, postear } from '@contave/ledger';
import { Decimal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, nominaPrestacionesKardex, nominaProvisiones, nominaTrabajadores } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalDecimal, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarCuentas, requerirPeriodoAbierto } from './nomina-comun';

export type Provision = typeof nominaProvisiones.$inferSelect;

export interface ResultadoProvisiones {
  readonly provisiones: Provision[];
  readonly journalEntryId: string;
}

/**
 * Provisiones mensuales de pasivos laborales (P15, docs/04 §2): 1/12 de utilidades, vacaciones y
 * bono vacacional, la garantía de prestaciones del mes y los intereses, por trabajador. Postea un
 * asiento consolidado (gasto 6.1 contra 2.4.02/03/04/05) en triple base. Idempotente por período
 * (unique company+anio+mes+trabajador). Bajo RLS y auditado.
 */
@Injectable()
export class ProvisionesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async generar(body: unknown): Promise<ResultadoProvisiones> {
    const e = parse(body);
    const rate = new Decimal(e.rateBcv);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new BadRequestException(`Empresa ${e.companyId} no encontrada`);

      const yaHay = await tx.select({ id: nominaProvisiones.id }).from(nominaProvisiones).where(and(eq(nominaProvisiones.companyId, e.companyId), eq(nominaProvisiones.anio, e.anio), eq(nominaProvisiones.mes, e.mes))).limit(1);
      if (yaHay.length > 0) throw new BadRequestException(`Ya se generaron las provisiones de ${e.anio}-${String(e.mes).padStart(2, '0')}`);

      const periodId = await requerirPeriodoAbierto(tx, e.companyId, e.anio, e.mes);
      const trabajadores = await tx.select().from(nominaTrabajadores).where(and(eq(nominaTrabajadores.companyId, e.companyId), eq(nominaTrabajadores.activo, true)));

      const entryId = randomUUID();
      const provisiones: Provision[] = [];
      let totUtil = new Decimal(0);
      let totVac = new Decimal(0);
      let totBono = new Decimal(0);
      let totPrest = new Decimal(0);
      let totInt = new Decimal(0);

      for (const t of trabajadores) {
        const sal = derivarSalarios({
          salarioNormalMensual: t.salarioNormalMensual,
          diasUtilidades: t.diasUtilidades ?? company.diasUtilidades ?? 30,
          diasBonoVacacional: t.diasBonoVacacional ?? 15,
        });
        const saldoGarantia = await this.saldoGarantia(tx, e.companyId, t.id);
        const prov = calcularProvisionesMes({
          salarioDiario: sal.salarioDiario,
          salarioDiarioIntegral: sal.salarioDiarioIntegral,
          diasUtilidades: t.diasUtilidades ?? company.diasUtilidades ?? 30,
          diasVacaciones: t.diasVacaciones ?? 15,
          diasBonoVacacional: t.diasBonoVacacional ?? 15,
          saldoGarantia,
          tasaInteresAnual: e.tasaInteresAnual ?? '0',
        });

        const [fila] = await tx
          .insert(nominaProvisiones)
          .values({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            anio: e.anio,
            mes: e.mes,
            trabajadorId: t.id,
            utilidades: prov.utilidades,
            vacaciones: prov.vacaciones,
            bonoVacacional: prov.bonoVacacional,
            prestaciones: prov.prestaciones,
            intereses: prov.intereses,
            total: prov.total,
            journalEntryId: entryId,
            createdBy: ctx.userId ?? null,
          })
          .returning();
        if (fila !== undefined) provisiones.push(fila);

        totUtil = totUtil.plus(prov.utilidades);
        totVac = totVac.plus(prov.vacaciones);
        totBono = totBono.plus(prov.bonoVacacional);
        totPrest = totPrest.plus(prov.prestaciones);
        totInt = totInt.plus(prov.intereses);
      }

      if (provisiones.length === 0) throw new BadRequestException('No hay trabajadores activos para provisionar');

      // Créditos a los pasivos laborales; el débito (gasto 6.1) absorbe la suma exacta en ambas bases.
      const usd = (v: Decimal): Decimal => v.div(rate);
      const creditos: Array<{ cuenta: string; ves: Decimal }> = [
        { cuenta: '2.4.04', ves: totUtil },
        { cuenta: '2.4.05', ves: totVac.plus(totBono) },
        { cuenta: '2.4.02', ves: totPrest },
        { cuenta: '2.4.03', ves: totInt },
      ].filter((c) => c.ves.gt(0));

      const totalVes = creditos.reduce((acc, c) => acc.plus(c.ves), new Decimal(0));
      const totalUsd = creditos.reduce((acc, c) => acc.plus(usd(c.ves)), new Decimal(0));

      const lineas: EntradaLinea[] = [
        { cuenta: '6.1', dc: 'D', moneda: 'VES', montoOrigen: totalVes.toFixed(8), montoVes: totalVes.toFixed(8), montoUsdMgmt: totalUsd.toFixed(8), rateBcv: rate.toFixed(), rateUsdMgmt: rate.toFixed() },
        ...creditos.map((c) => ({
          cuenta: c.cuenta,
          dc: 'C' as const,
          moneda: 'VES',
          montoOrigen: c.ves.toFixed(8),
          montoVes: c.ves.toFixed(8),
          montoUsdMgmt: usd(c.ves).toFixed(8),
          rateBcv: rate.toFixed(),
          rateUsdMgmt: rate.toFixed(),
        })),
      ];

      const asiento = postear(Asiento.construir({ id: entryId, companyId: e.companyId, fecha: finDeMes(e.anio, e.mes), descripcion: `Provisiones laborales ${e.anio}-${String(e.mes).padStart(2, '0')}`, lineas, sourceType: 'NOMINA_PROVISION', sourceId: entryId }));
      await persistirAsiento(tx, asiento, { tenantId: ctx.tenantId, companyId: e.companyId, periodId, createdBy: ctx.userId ?? null, cuentas: (await cargarCuentas(tx, e.companyId)).porCodigo });

      await this.audit.registrar(tx, { accion: 'nomina.provisiones_generar', entidad: 'nomina_provisiones', entidadId: entryId, after: { count: provisiones.length, totalVes: totalVes.toFixed(2) } });
      return { provisiones, journalEntryId: entryId };
    });
  }

  async listar(companyId: string, anio: number, mes: number): Promise<Provision[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaProvisiones).where(and(eq(nominaProvisiones.companyId, cid), eq(nominaProvisiones.anio, anio), eq(nominaProvisiones.mes, mes)));
    });
  }

  private async saldoGarantia(tx: DatabaseTx, companyId: string, trabajadorId: string): Promise<string> {
    const movs = await tx.select({ tipo: nominaPrestacionesKardex.tipo, montoVes: nominaPrestacionesKardex.montoVes }).from(nominaPrestacionesKardex).where(and(eq(nominaPrestacionesKardex.companyId, companyId), eq(nominaPrestacionesKardex.trabajadorId, trabajadorId)));
    const suman = new Set(['DEPOSITO_TRIMESTRAL', 'DIAS_ADICIONALES', 'INTERES']);
    return movs.reduce((acc, m) => (suman.has(m.tipo) ? acc.plus(m.montoVes) : acc.minus(m.montoVes)), new Decimal(0)).toFixed(8);
  }
}

interface ProvisionesInput {
  companyId: string;
  anio: number;
  mes: number;
  rateBcv: string;
  tasaInteresAnual: string | null;
}

function parse(body: unknown): ProvisionesInput {
  const b = asRecord(body);
  const anio = Number(b.anio);
  const mes = Number(b.mes);
  if (!Number.isInteger(anio) || anio < 2000) throw new BadRequestException('anio inválido');
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('mes inválido');
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    anio,
    mes,
    rateBcv: requireDecimal(b.rateBcv, 'rateBcv'),
    tasaInteresAnual: optionalDecimal(b.tasaInteresAnual, 'tasaInteresAnual'),
  };
}

/** Instante UTC del último día del mes (≈ mediodía Caracas). */
function finDeMes(anio: number, mes: number): Date {
  return new Date(Date.UTC(anio, mes - 1, 28, 16, 0, 0));
}
