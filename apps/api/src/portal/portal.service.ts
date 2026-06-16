import { BadRequestException, Injectable } from '@nestjs/common';
import { fechaFiscal, periodoFiscal } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { CierreMensualService, type PasoCierre } from '../contabilidad/cierre-mensual.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { cierresMensuales, companies, periods, taxReturns } from '../db/schema';
import { optionalInt } from '../maestros/validacion';
import { withTenant } from '../tenant/with-tenant';
import {
  claveDeclaracion,
  etiquetaPeriodo,
  obligacionesDeEmpresa,
  type ObligacionPortal,
  periodoAnterior,
  type PerfilEmpresa,
} from './obligaciones';

export type EstadoCierreActual = 'OPEN' | 'CLOSED' | 'REABIERTO' | 'SIN_PERIODO';

export interface EstadoCierreEmpresa {
  /** Último período cerrado, `'YYYY-MM'`, o null si nunca cerró. */
  readonly ultimoCerrado: string | null;
  /** Cantidad de períodos en estado OPEN (cierres pendientes). */
  readonly periodosAbiertos: number;
  /** Período fiscal en curso, `'YYYY-MM'`. */
  readonly periodoActual: string;
  readonly estadoActual: EstadoCierreActual;
}

export interface ResumenObligaciones {
  readonly pendientes: number;
  readonly vencidas: number;
  /** Obligación pendiente más próxima a vencer (o ya vencida), null si no hay. */
  readonly proxima: ObligacionPortal | null;
}

export interface EmpresaPanel {
  readonly companyId: string;
  readonly rif: string;
  readonly razonSocial: string;
  readonly tipoContribuyente: string;
  readonly spe: boolean;
  readonly cierre: EstadoCierreEmpresa;
  readonly obligaciones: ResumenObligaciones;
}

export interface PanelDto {
  readonly fecha: string;
  readonly periodoActual: string;
  readonly empresas: EmpresaPanel[];
  readonly totales: { readonly empresas: number; readonly obligacionesPendientes: number; readonly obligacionesVencidas: number; readonly cierresPendientes: number };
}

export interface CalendarioDto {
  readonly fecha: string;
  readonly obligaciones: ObligacionPortal[];
}

export interface ChecklistEmpresa {
  readonly companyId: string;
  readonly rif: string;
  readonly razonSocial: string;
  readonly yaCerrado: boolean;
  readonly puedeCerrar: boolean;
  readonly pasos: PasoCierre[];
}

export interface ChecklistMasivoDto {
  readonly anio: number;
  readonly mes: number;
  readonly empresas: ChecklistEmpresa[];
  readonly totales: { readonly empresas: number; readonly listas: number; readonly cerradas: number };
}

/**
 * Portal del contador (P16, docs/06 M11). Vista TENANT-level (no por empresa): agrega la cartera de
 * `companies` del tenant en contexto —el "contador con cartera" de docs/05 §2— en tres lecturas:
 * panel multi-empresa con estado de cierres, calendario consolidado de obligaciones y checklist
 * masivo de cierre. Todo se DERIVA de las tablas existentes (periods, cierres_mensuales, tax_returns,
 * companies); no almacena nada (regla 8). El checklist masivo reusa el wizard de P13 por empresa.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cierre: CierreMensualService,
  ) {}

  /** Panel multi-empresa: por cada empresa, estado de cierres y resumen de obligaciones próximas. */
  async panel(): Promise<PanelDto> {
    const hoy = fechaFiscal(new Date());
    const { anio, mes } = periodoFiscal(new Date());
    const ventana = [periodoAnterior(anio, mes), { anio, mes }];

    return withTenant(this.database.db, async (tx) => {
      const { empresas, periodosPorEmpresa, cierresPorEmpresa, presentadasPorEmpresa } = await this.cargarCartera(tx);

      const filas: EmpresaPanel[] = empresas.map((e) => {
        const cierre = estadoCierre(periodosPorEmpresa.get(e.companyId) ?? [], cierresPorEmpresa.get(e.companyId) ?? [], anio, mes);
        const obligaciones = obligacionesDeEmpresa(e, hoy, ventana, presentadasPorEmpresa.get(e.companyId) ?? new Set());
        const pendientes = obligaciones.filter((o) => o.estado === 'PENDIENTE');
        const proxima = pendientes.slice().sort((a, b) => a.diasRestantes - b.diasRestantes)[0] ?? null;
        return {
          ...e,
          cierre,
          obligaciones: { pendientes: pendientes.length, vencidas: pendientes.filter((o) => o.diasRestantes < 0).length, proxima },
        };
      });

      return {
        fecha: hoy,
        periodoActual: etiquetaPeriodo(anio, mes),
        empresas: filas,
        totales: {
          empresas: filas.length,
          obligacionesPendientes: filas.reduce((s, f) => s + f.obligaciones.pendientes, 0),
          obligacionesVencidas: filas.reduce((s, f) => s + f.obligaciones.vencidas, 0),
          cierresPendientes: filas.filter((f) => f.cierre.estadoActual === 'OPEN' || f.cierre.estadoActual === 'REABIERTO').length,
        },
      };
    });
  }

  /** Calendario consolidado: todas las obligaciones de la cartera, ordenadas por vencimiento. */
  async calendario(): Promise<CalendarioDto> {
    const hoy = fechaFiscal(new Date());
    const { anio, mes } = periodoFiscal(new Date());
    const ventana = [periodoAnterior(anio, mes), { anio, mes }];

    return withTenant(this.database.db, async (tx) => {
      const { empresas, presentadasPorEmpresa } = await this.cargarCartera(tx, { soloObligaciones: true });
      const obligaciones = empresas
        .flatMap((e) => obligacionesDeEmpresa(e, hoy, ventana, presentadasPorEmpresa.get(e.companyId) ?? new Set()))
        .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite) || a.razonSocial.localeCompare(b.razonSocial));
      return { fecha: hoy, obligaciones };
    });
  }

  /**
   * Checklist masivo de cierre del período `anio-mes`: corre el wizard de P13 (`evaluar`) por cada
   * empresa de la cartera sin mutar nada, y reporta cuáles ya están cerradas y cuáles listas para cerrar.
   */
  async checklistMasivo(query: unknown): Promise<ChecklistMasivoDto> {
    const { anio, mes } = parsePeriodoQuery(query);

    const { empresas, cerradas } = await withTenant(this.database.db, async (tx) => {
      const { empresas } = await this.cargarCartera(tx, { soloObligaciones: true });
      const cierres = await tx
        .select({ companyId: cierresMensuales.companyId, estado: cierresMensuales.estado, mes: cierresMensuales.mes })
        .from(cierresMensuales)
        .where(eq(cierresMensuales.anio, anio));
      const cerradas = new Set(cierres.filter((c) => c.mes === mes && c.estado === 'CERRADO').map((c) => c.companyId));
      return { empresas, cerradas };
    });

    // `evaluar` abre su propia transacción de tenant por empresa (lectura pura, idempotente).
    const filas: ChecklistEmpresa[] = [];
    for (const e of empresas) {
      const evaluacion = await this.cierre.evaluar({ companyId: e.companyId, anio, mes });
      filas.push({
        companyId: e.companyId,
        rif: e.rif,
        razonSocial: e.razonSocial,
        yaCerrado: cerradas.has(e.companyId),
        puedeCerrar: evaluacion.puedeCerrar,
        pasos: evaluacion.pasos,
      });
    }

    return {
      anio,
      mes,
      empresas: filas,
      totales: {
        empresas: filas.length,
        listas: filas.filter((f) => f.puedeCerrar && !f.yaCerrado).length,
        cerradas: filas.filter((f) => f.yaCerrado).length,
      },
    };
  }

  /**
   * Carga la cartera del tenant: empresas (perfil) y, salvo `soloObligaciones`, sus períodos y cierres.
   * Las declaraciones PRESENTADAS se devuelven como Set por empresa para resolver el estado en memoria.
   */
  private async cargarCartera(
    tx: DatabaseTx,
    opciones: { soloObligaciones?: boolean } = {},
  ): Promise<{
    empresas: PerfilEmpresa[];
    periodosPorEmpresa: Map<string, { anio: number; mes: number; estado: string }[]>;
    cierresPorEmpresa: Map<string, { anio: number; mes: number; estado: string }[]>;
    presentadasPorEmpresa: Map<string, Set<string>>;
  }> {
    const filasEmpresa = await tx
      .select({ id: companies.id, rif: companies.rif, razonSocial: companies.razonSocial, tipo: companies.tipoContribuyente, spe: companies.spe })
      .from(companies);
    const empresas: PerfilEmpresa[] = filasEmpresa.map((c) => ({ companyId: c.id, rif: c.rif, razonSocial: c.razonSocial, tipoContribuyente: c.tipo, spe: c.spe }));

    const presentadasPorEmpresa = new Map<string, Set<string>>();
    const declaraciones = await tx
      .select({ companyId: taxReturns.companyId, tipo: taxReturns.tipo, anio: taxReturns.periodoAnio, mes: taxReturns.periodoMes, status: taxReturns.status })
      .from(taxReturns)
      .where(eq(taxReturns.status, 'PRESENTADA'));
    for (const d of declaraciones) {
      const set = presentadasPorEmpresa.get(d.companyId) ?? new Set<string>();
      set.add(claveDeclaracion(d.tipo, d.anio, d.mes));
      presentadasPorEmpresa.set(d.companyId, set);
    }

    const periodosPorEmpresa = new Map<string, { anio: number; mes: number; estado: string }[]>();
    const cierresPorEmpresa = new Map<string, { anio: number; mes: number; estado: string }[]>();
    if (opciones.soloObligaciones !== true) {
      const periodosFilas = await tx.select({ companyId: periods.companyId, anio: periods.anio, mes: periods.mes, estado: periods.estado }).from(periods);
      for (const p of periodosFilas) {
        const arr = periodosPorEmpresa.get(p.companyId) ?? [];
        arr.push({ anio: p.anio, mes: p.mes, estado: p.estado });
        periodosPorEmpresa.set(p.companyId, arr);
      }
      const cierresFilas = await tx.select({ companyId: cierresMensuales.companyId, anio: cierresMensuales.anio, mes: cierresMensuales.mes, estado: cierresMensuales.estado }).from(cierresMensuales);
      for (const c of cierresFilas) {
        const arr = cierresPorEmpresa.get(c.companyId) ?? [];
        arr.push({ anio: c.anio, mes: c.mes, estado: c.estado });
        cierresPorEmpresa.set(c.companyId, arr);
      }
    }

    return { empresas, periodosPorEmpresa, cierresPorEmpresa, presentadasPorEmpresa };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Estado de cierre de una empresa a partir de sus períodos y cierres. */
function estadoCierre(
  periodosEmpresa: ReadonlyArray<{ anio: number; mes: number; estado: string }>,
  cierresEmpresa: ReadonlyArray<{ anio: number; mes: number; estado: string }>,
  anio: number,
  mes: number,
): EstadoCierreEmpresa {
  const cerrados = periodosEmpresa.filter((p) => p.estado === 'CLOSED');
  const ultimoCerrado = cerrados.length === 0 ? null : cerrados.map((p) => p.anio * 12 + (p.mes - 1)).reduce((a, b) => Math.max(a, b));
  const periodoActualRow = periodosEmpresa.find((p) => p.anio === anio && p.mes === mes);
  const reabierto = cierresEmpresa.some((c) => c.anio === anio && c.mes === mes && c.estado === 'REABIERTO');
  const estadoActual: EstadoCierreActual = reabierto
    ? 'REABIERTO'
    : periodoActualRow === undefined
      ? 'SIN_PERIODO'
      : periodoActualRow.estado === 'CLOSED'
        ? 'CLOSED'
        : 'OPEN';
  return {
    ultimoCerrado: ultimoCerrado === null ? null : etiquetaPeriodo(Math.floor(ultimoCerrado / 12), (ultimoCerrado % 12) + 1),
    periodosAbiertos: periodosEmpresa.filter((p) => p.estado === 'OPEN').length,
    periodoActual: etiquetaPeriodo(anio, mes),
    estadoActual,
  };
}

function parsePeriodoQuery(query: unknown): { anio: number; mes: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const anio = optionalInt(q.anio, 'anio', 0, 2000);
  const mes = optionalInt(q.mes, 'mes', 0, 1);
  if (anio < 2000 || mes < 1 || mes > 12) throw new BadRequestException('anio/mes inválidos');
  return { anio, mes };
}
