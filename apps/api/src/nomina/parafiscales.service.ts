import { BadRequestException, Injectable } from '@nestjs/common';
import { calcularParafiscales, derivarSalarios, type ResultadoParafiscales, semanasCotizablesDelMes } from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, nominaParafiscales, nominaTrabajadores } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, requireEnum, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarParametrosNomina, etiquetaMes, normalizarRiesgo } from './nomina-comun';
import { type ArchivoPlanilla, type FilaTrabajadorPlanilla, generarFaovTxt, generarIncesExcel, generarTiunaTxt } from './planillas';

export type Parafiscal = typeof nominaParafiscales.$inferSelect;

const REGIMENES = ['IVSS', 'RPE', 'FAOV', 'INCES'] as const;
type Regimen = (typeof REGIMENES)[number];

/**
 * Parafiscales (P15, docs/04 §3): liquidación por período y régimen (IVSS/RPE/FAOV/INCES) sumando el
 * cálculo puro de cada trabajador, y generación de las planillas (TIUNA, FAOV/BANAVIH, INCES). Bajo
 * RLS y auditado. La planilla PRESENTADA es inmutable (trigger en 0046).
 */
@Injectable()
export class ParafiscalesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async calcular(body: unknown): Promise<Parafiscal[]> {
    const e = parsePeriodo(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const yaHay = await tx.select({ id: nominaParafiscales.id, estado: nominaParafiscales.estadoPlanilla }).from(nominaParafiscales).where(and(eq(nominaParafiscales.companyId, e.companyId), eq(nominaParafiscales.anio, e.anio), eq(nominaParafiscales.mes, e.mes)));
      if (yaHay.some((r) => r.estado === 'PRESENTADA')) throw new BadRequestException('Ya hay planillas PRESENTADAS para el período; no se recalcula');
      // Recalcular: borrar las liquidaciones no presentadas del período.
      if (yaHay.length > 0) await tx.delete(nominaParafiscales).where(and(eq(nominaParafiscales.companyId, e.companyId), eq(nominaParafiscales.anio, e.anio), eq(nominaParafiscales.mes, e.mes)));

      const agregados = await this.agregar(tx, e.companyId, e.anio, e.mes);
      const semanas = semanasCotizablesDelMes(e.anio, e.mes);
      const filas: Parafiscal[] = [];
      for (const regimen of REGIMENES) {
        const a = agregados[regimen];
        const [fila] = await tx
          .insert(nominaParafiscales)
          .values({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            anio: e.anio,
            mes: e.mes,
            regimen,
            baseVes: a.base.toFixed(8),
            montoTrabajadorVes: a.trabajador.toFixed(8),
            montoPatronoVes: a.patrono.toFixed(8),
            semanasCotizables: regimen === 'IVSS' || regimen === 'RPE' ? semanas : null,
            estadoPlanilla: 'BORRADOR',
            createdBy: ctx.userId ?? null,
          })
          .returning();
        if (fila !== undefined) filas.push(fila);
      }
      await this.audit.registrar(tx, { accion: 'nomina.parafiscales_calcular', entidad: 'nomina_parafiscales', entidadId: `${e.companyId}:${etiquetaMes(e.anio, e.mes)}`, after: { count: filas.length } });
      return filas;
    });
  }

  async listar(companyId: string, anio: number, mes: number): Promise<Parafiscal[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaParafiscales).where(and(eq(nominaParafiscales.companyId, cid), eq(nominaParafiscales.anio, anio), eq(nominaParafiscales.mes, mes)));
    });
  }

  /** Genera el archivo de la planilla de un régimen (TIUNA/FAOV/INCES) y marca la planilla GENERADA. */
  async generarPlanilla(body: unknown): Promise<ArchivoPlanilla> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const anio = Number(b.anio);
    const mes = Number(b.mes);
    const regimen = requireEnum(b.regimen, 'regimen', REGIMENES, (s) => s.toUpperCase());
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('anio/mes inválidos');

    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const filas = await this.filasPorTrabajador(tx, companyId, anio, mes, regimen);
      const periodo = etiquetaMes(anio, mes);
      const archivo =
        regimen === 'FAOV'
          ? generarFaovTxt(periodo, filas)
          : regimen === 'INCES'
            ? generarIncesExcel(periodo, filas)
            : generarTiunaTxt(regimen, periodo, filas);
      await tx.update(nominaParafiscales).set({ estadoPlanilla: 'GENERADA', archivoRef: archivo.filename }).where(and(eq(nominaParafiscales.companyId, companyId), eq(nominaParafiscales.anio, anio), eq(nominaParafiscales.mes, mes), eq(nominaParafiscales.regimen, regimen), eq(nominaParafiscales.estadoPlanilla, 'BORRADOR')));
      return archivo;
    });
  }

  // ── internos ────────────────────────────────────────────────────────────────

  private async porTrabajador(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<Array<{ trabajador: typeof nominaTrabajadores.$inferSelect; res: ResultadoParafiscales }>> {
    const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (company === undefined) throw new BadRequestException(`Empresa ${companyId} no encontrada`);
    const params = await cargarParametrosNomina(tx, `${anio}-${String(mes).padStart(2, '0')}-15`);
    const semanas = semanasCotizablesDelMes(anio, mes);
    const trabajadores = await tx.select().from(nominaTrabajadores).where(and(eq(nominaTrabajadores.companyId, companyId), eq(nominaTrabajadores.activo, true)));
    const cinco = trabajadores.length >= 5;

    return trabajadores.map((t) => {
      const sal = derivarSalarios({ salarioNormalMensual: t.salarioNormalMensual, diasUtilidades: t.diasUtilidades ?? company.diasUtilidades ?? 30, diasBonoVacacional: t.diasBonoVacacional ?? 15 });
      const res = calcularParafiscales({
        salarioNormalMensual: t.salarioNormalMensual,
        salarioIntegralMensual: sal.salarioIntegralMensual,
        salarioMinimoMensual: params.salarioMinimoMensual,
        riesgoIvss: normalizarRiesgo(t.riesgoIvss ?? company.riesgoIvss),
        semanasCotizables: semanas,
        cincoOMasTrabajadores: cinco,
        alicuotas: params.alicuotas,
      });
      return { trabajador: t, res };
    });
  }

  private async agregar(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<Record<Regimen, AcumuladoRegimen>> {
    const cero = (): AcumuladoRegimen => ({ base: new Decimal(0), trabajador: new Decimal(0), patrono: new Decimal(0) });
    const acc: Record<Regimen, AcumuladoRegimen> = { IVSS: cero(), RPE: cero(), FAOV: cero(), INCES: cero() };
    for (const { res } of await this.porTrabajador(tx, companyId, anio, mes)) {
      for (const regimen of REGIMENES) {
        const d = res[regimen.toLowerCase() as 'ivss'];
        acc[regimen].base = acc[regimen].base.plus(d.base);
        acc[regimen].trabajador = acc[regimen].trabajador.plus(d.trabajador);
        acc[regimen].patrono = acc[regimen].patrono.plus(d.patrono);
      }
    }
    return acc;
  }

  private async filasPorTrabajador(tx: DatabaseTx, companyId: string, anio: number, mes: number, regimen: Regimen): Promise<FilaTrabajadorPlanilla[]> {
    return (await this.porTrabajador(tx, companyId, anio, mes)).map(({ trabajador, res }) => {
      const d = res[regimen.toLowerCase() as 'ivss'];
      return { cedula: trabajador.cedula, nombre: trabajador.nombre, base: d.base, trabajador: d.trabajador, patrono: d.patrono };
    });
  }
}

interface AcumuladoRegimen {
  base: Decimal;
  trabajador: Decimal;
  patrono: Decimal;
}

interface PeriodoInput {
  companyId: string;
  anio: number;
  mes: number;
}

function parsePeriodo(body: unknown): PeriodoInput {
  const b = asRecord(body);
  const anio = Number(b.anio);
  const mes = Number(b.mes);
  if (!Number.isInteger(anio) || anio < 2000) throw new BadRequestException('anio inválido');
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('mes inválido');
  return { companyId: requireUuid(b.companyId, 'companyId'), anio, mes };
}
