import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { balanceDeComprobacionDesdeMovimientos } from '@contave/ledger';
import { fechaFiscal } from '@contave/shared';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { bankAccounts, cierresMensuales, documents, exchangeRates, journalEntries, periods, revaluaciones, statementLines } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, requireDecimal, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { RevaluacionService } from '../tesoreria/revaluacion.service';
import { movimientosPorCuenta } from './agregacion-saldos';
import { hashIntegridad, rolDelActor } from './contabilidad-comun';

export type Cierre = typeof cierresMensuales.$inferSelect;
export type Period = typeof periods.$inferSelect;

export type EstadoPaso = 'OK' | 'PENDIENTE' | 'NO_APLICA' | 'OMITIDO_TODO';
export type ClavePaso =
  | 'tasas'
  | 'sin_borradores'
  | 'conciliacion'
  | 'fx_no_realizado'
  | 'depreciacion'
  | 'provisiones_laborales'
  | 'prorrata_iva'
  | 'balance_cuadrado';

export interface PasoCierre {
  paso: number;
  clave: ClavePaso;
  estado: EstadoPaso;
  bloqueante: boolean;
  detalle: string;
}

export interface EvaluacionCierre {
  companyId: string;
  anio: number;
  mes: number;
  pasos: PasoCierre[];
  puedeCerrar: boolean;
}

const ROLES_REAPERTURA = new Set(['owner', 'contador']);

/**
 * Wizard de cierre mensual (P13, docs/06 M6, casos 11/42/43). `evaluar` corre el checklist de 8
 * pasos sin mutar nada; `cerrar` ejecuta los asientos automáticos idempotentes (paso 4 reusa
 * `RevaluacionService`), verifica el balance y BLOQUEA el período; `reabrir` (owner+contador, motivo
 * obligatorio, auditado) lo abre de nuevo y obliga a re-correr el wizard. Todo es idempotente: la
 * unicidad `(company, anio, mes)` y las claves de cada sub-asiento evitan duplicar al re-ejecutar.
 *
 * Pasos 5–7 (depreciación, provisiones laborales, prorrata IVA) dependen de módulos aún inexistentes
 * (M9 activos fijos, M8 nómina): se marcan OMITIDO_TODO y NO bloquean. Se cablearán cuando lleguen.
 */
@Injectable()
export class CierreMensualService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly revaluacion: RevaluacionService,
  ) {}

  async evaluar(body: unknown): Promise<EvaluacionCierre> {
    const { companyId, anio, mes } = parsePeriodo(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const period = await buscarPeriodoCompleto(tx, companyId, anio, mes);
      return evaluarInterno(tx, companyId, anio, mes, period);
    });
  }

  async cerrar(body: unknown): Promise<{ cierre: Cierre; period: Period }> {
    const { companyId, anio, mes } = parsePeriodo(body);
    const rateCierre = requireDecimal(asRecord(body).rateCierre, 'rateCierre');

    // 1) Pre-chequeo (idempotencia + período + bloqueantes) en una transacción de lectura.
    const pre = await withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const period = await buscarPeriodoCompleto(tx, companyId, anio, mes);
      if (period === undefined) throw new BadRequestException(`No existe período contable ${etiqueta(anio, mes)}; créelo primero`);

      const existente = await buscarCierre(tx, companyId, anio, mes);
      if (existente !== undefined && existente.estado === 'CERRADO') {
        return { yaCerrado: true as const, cierre: existente, period };
      }
      const evaluacion = await evaluarInterno(tx, companyId, anio, mes, period);
      if (!evaluacion.puedeCerrar) {
        throw new BadRequestException(`No se puede cerrar ${etiqueta(anio, mes)}: ${bloqueos(evaluacion)}`);
      }
      return { yaCerrado: false as const, period };
    });
    if (pre.yaCerrado) return { cierre: pre.cierre, period: pre.period };

    // 2) Asientos automáticos idempotentes (su propia transacción). Paso 4: diferencial NO realizado.
    const rev = await this.revaluacion.ejecutar({ companyId, anio, mes, rateCierre });
    // TODO: depreciación (M9), provisiones laborales (M8) y prorrata IVA cuando existan esos módulos.

    // 3) Verificación final + bloqueo del período + registro del cierre, atómico.
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const period = await buscarPeriodoCompleto(tx, companyId, anio, mes);
      if (period === undefined) throw new Error('El período desapareció durante el cierre');

      const evaluacion = await evaluarInterno(tx, companyId, anio, mes, period);
      if (!evaluacion.puedeCerrar) {
        throw new BadRequestException(`No se puede cerrar ${etiqueta(anio, mes)}: ${bloqueos(evaluacion)}`);
      }
      const balanceCuadra = evaluacion.pasos.find((p) => p.clave === 'balance_cuadrado')?.estado === 'OK';

      const id = randomUUID();
      const ahora = new Date();
      const hash = hashIntegridad({ companyId, anio, mes, revaluacionId: rev.revaluacion.id, balanceCuadra });
      const [cierre] = await tx
        .insert(cierresMensuales)
        .values({
          id,
          tenantId: ctx.tenantId,
          companyId,
          anio,
          mes,
          periodId: period.id,
          estado: 'CERRADO',
          checklist: evaluacion.pasos,
          revaluacionId: rev.revaluacion.id,
          balanceCuadra,
          closedBy: ctx.userId ?? null,
          closedAt: ahora,
          hash,
        })
        .onConflictDoUpdate({
          target: [cierresMensuales.companyId, cierresMensuales.anio, cierresMensuales.mes],
          set: {
            estado: 'CERRADO',
            checklist: evaluacion.pasos,
            revaluacionId: rev.revaluacion.id,
            balanceCuadra,
            closedBy: ctx.userId ?? null,
            closedAt: ahora,
            reopenReason: null,
            reopenedBy: null,
            reopenedAt: null,
            hash,
          },
        })
        .returning();
      if (cierre === undefined) throw new Error('No se pudo registrar el cierre');

      const [periodCerrado] = await tx
        .update(periods)
        .set({ estado: 'CLOSED', closedBy: ctx.userId ?? null, closedAt: ahora })
        .where(eq(periods.id, period.id))
        .returning();
      if (periodCerrado === undefined) throw new Error('No se pudo bloquear el período');

      await this.audit.registrar(tx, { accion: 'contabilidad.cierre', entidad: 'cierres_mensuales', entidadId: cierre.id, after: cierre });
      return { cierre, period: periodCerrado };
    });
  }

  async reabrir(body: unknown): Promise<{ cierre: Cierre; period: Period }> {
    const { companyId, anio, mes } = parsePeriodo(body);
    const reason = requireString(asRecord(body).reason, 'reason', 500);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      // Autorización por rol (caso 43): solo owner+contador reabren.
      const rol = await rolDelActor(tx, ctx.userId);
      if (rol === null || !ROLES_REAPERTURA.has(rol)) {
        throw new ForbiddenException('Solo owner o contador pueden reabrir un período cerrado (caso 43)');
      }

      const cierre = await buscarCierre(tx, companyId, anio, mes);
      if (cierre === undefined || cierre.estado !== 'CERRADO') {
        throw new BadRequestException(`El período ${etiqueta(anio, mes)} no está cerrado`);
      }
      const period = await buscarPeriodoCompleto(tx, companyId, anio, mes);
      if (period === undefined) throw new Error('Período inexistente');

      const ahora = new Date();
      const [reabierto] = await tx
        .update(cierresMensuales)
        .set({ estado: 'REABIERTO', reopenedBy: ctx.userId ?? null, reopenedAt: ahora, reopenReason: reason })
        .where(eq(cierresMensuales.id, cierre.id))
        .returning();
      if (reabierto === undefined) throw new Error('No se pudo reabrir el cierre');

      const [periodAbierto] = await tx.update(periods).set({ estado: 'OPEN' }).where(eq(periods.id, period.id)).returning();
      if (periodAbierto === undefined) throw new Error('No se pudo reabrir el período');

      await this.audit.registrar(tx, { accion: 'contabilidad.reabrir', entidad: 'cierres_mensuales', entidadId: reabierto.id, before: cierre, after: reabierto });
      return { cierre: reabierto, period: periodAbierto };
    });
  }
}

// ── Evaluación del checklist ───────────────────────────────────────────────────

async function evaluarInterno(
  tx: DatabaseTx,
  companyId: string,
  anio: number,
  mes: number,
  period: { id: string } | undefined,
): Promise<EvaluacionCierre> {
  const pasos: PasoCierre[] = [
    await pasoTasas(tx, anio, mes),
    await pasoSinBorradores(tx, companyId, anio, mes, period),
    await pasoConciliacion(tx, companyId, anio, mes),
    await pasoFxNoRealizado(tx, companyId, anio, mes),
    pasoTodo(5, 'depreciacion', 'Depreciación: pendiente del módulo de activos fijos (M9)'),
    pasoTodo(6, 'provisiones_laborales', 'Provisiones laborales: pendiente del módulo de nómina (M8)'),
    pasoTodo(7, 'prorrata_iva', 'Prorrata de IVA: pendiente del módulo de impuestos'),
    await pasoBalance(tx, companyId, anio, mes),
  ];
  const puedeCerrar = pasos.filter((p) => p.bloqueante).every((p) => p.estado === 'OK' || p.estado === 'NO_APLICA');
  return { companyId, anio, mes, pasos, puedeCerrar };
}

async function pasoTasas(tx: DatabaseTx, anio: number, mes: number): Promise<PasoCierre> {
  const ult = ultimoDia(anio, mes);
  const hastaDia = diaCorte(anio, mes, ult);
  const habiles = diasHabiles(anio, mes, hastaDia);
  const [r] = await tx
    .select({ n: sql<number>`count(distinct ${exchangeRates.rateDate})::int` })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.source, 'BCV'), gte(exchangeRates.rateDate, fecha(anio, mes, 1)), lte(exchangeRates.rateDate, fecha(anio, mes, ult))));
  const cargadas = r?.n ?? 0;
  const ok = habiles > 0 && cargadas >= habiles;
  return paso(1, 'tasas', ok ? 'OK' : 'PENDIENTE', true, ok ? `Tasas BCV completas (${cargadas}/${habiles} días hábiles)` : `Faltan tasas BCV: ${cargadas}/${habiles} días hábiles cargados`);
}

async function pasoSinBorradores(tx: DatabaseTx, companyId: string, anio: number, mes: number, period: { id: string } | undefined): Promise<PasoCierre> {
  const ult = ultimoDia(anio, mes);
  let asientosDraft = 0;
  if (period !== undefined) {
    const [a] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.periodId, period.id), eq(journalEntries.estado, 'DRAFT')));
    asientosDraft = a?.n ?? 0;
  }
  const [d] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), eq(documents.status, 'DRAFT'), gte(documents.issueFechaFiscal, fecha(anio, mes, 1)), lte(documents.issueFechaFiscal, fecha(anio, mes, ult))));
  const docsDraft = d?.n ?? 0;
  const ok = asientosDraft === 0 && docsDraft === 0;
  return paso(2, 'sin_borradores', ok ? 'OK' : 'PENDIENTE', true, ok ? 'Sin borradores pendientes' : `Borradores por resolver: ${asientosDraft} asientos, ${docsDraft} documentos`);
}

async function pasoConciliacion(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<PasoCierre> {
  const [b] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.activo, true)));
  if ((b?.n ?? 0) === 0) {
    return paso(3, 'conciliacion', 'NO_APLICA', true, 'Sin cuentas bancarias activas');
  }
  const ult = ultimoDia(anio, mes);
  const [p] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(statementLines)
    .where(and(eq(statementLines.companyId, companyId), eq(statementLines.estado, 'PENDIENTE'), gte(statementLines.fecha, fecha(anio, mes, 1)), lte(statementLines.fecha, fecha(anio, mes, ult))));
  const pendientes = p?.n ?? 0;
  const ok = pendientes === 0;
  return paso(3, 'conciliacion', ok ? 'OK' : 'PENDIENTE', true, ok ? 'Conciliaciones bancarias al día' : `Movimientos bancarios sin conciliar: ${pendientes}`);
}

async function pasoFxNoRealizado(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<PasoCierre> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(revaluaciones)
    .where(and(eq(revaluaciones.companyId, companyId), eq(revaluaciones.anio, anio), eq(revaluaciones.mes, mes)));
  const existe = (r?.n ?? 0) > 0;
  // No bloqueante: el cierre la genera (idempotente). Si ya existe, queda OK.
  return paso(4, 'fx_no_realizado', existe ? 'OK' : 'PENDIENTE', false, existe ? 'Diferencial no realizado ya registrado' : 'Se generará el asiento reversible (idempotente) al cerrar');
}

async function pasoBalance(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<PasoCierre> {
  const movs = await movimientosPorCuenta(tx, companyId, { hasta: { anio, mes } });
  const bc = balanceDeComprobacionDesdeMovimientos(movs);
  const ok = bc.cuadraVes && bc.cuadraUsd;
  return paso(8, 'balance_cuadrado', ok ? 'OK' : 'PENDIENTE', true, ok ? 'Balance de comprobación cuadrado en ambas bases' : 'El balance de comprobación no cuadra');
}

// ── Helpers de consulta ─────────────────────────────────────────────────────

async function buscarPeriodoCompleto(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<Period | undefined> {
  const [row] = await tx
    .select()
    .from(periods)
    .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
    .limit(1);
  return row;
}

async function buscarCierre(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<Cierre | undefined> {
  const [row] = await tx
    .select()
    .from(cierresMensuales)
    .where(and(eq(cierresMensuales.companyId, companyId), eq(cierresMensuales.anio, anio), eq(cierresMensuales.mes, mes)))
    .limit(1);
  return row;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

function parsePeriodo(body: unknown): { companyId: string; anio: number; mes: number } {
  const b = asRecord(body);
  const anio = optionalInt(b.anio, 'anio', 0, 2000);
  const mes = optionalInt(b.mes, 'mes', 0, 1);
  if (anio < 2000 || mes < 1 || mes > 12) throw new BadRequestException('anio/mes inválidos');
  return { companyId: requireUuid(b.companyId, 'companyId'), anio, mes };
}

function paso(n: number, clave: ClavePaso, estado: EstadoPaso, bloqueante: boolean, detalle: string): PasoCierre {
  return { paso: n, clave, estado, bloqueante, detalle };
}

function pasoTodo(n: number, clave: ClavePaso, detalle: string): PasoCierre {
  return paso(n, clave, 'OMITIDO_TODO', false, detalle);
}

function bloqueos(e: EvaluacionCierre): string {
  return e.pasos
    .filter((p) => p.bloqueante && p.estado !== 'OK' && p.estado !== 'NO_APLICA')
    .map((p) => `${p.clave} (${p.detalle})`)
    .join('; ');
}

function ultimoDia(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Día de corte para contar tasas: hoy si el mes es el corriente, el último si es pasado/futuro. */
function diaCorte(anio: number, mes: number, ult: number): number {
  const hoy = fechaFiscal(new Date());
  const [hy, hm, hd] = hoy.split('-').map(Number) as [number, number, number];
  const ordActual = hy * 12 + (hm - 1);
  const ordPeriodo = anio * 12 + (mes - 1);
  if (ordPeriodo === ordActual) return hd;
  return ult;
}

function diasHabiles(anio: number, mes: number, hastaDia: number): number {
  let n = 0;
  for (let d = 1; d <= hastaDia; d++) {
    const dow = new Date(Date.UTC(anio, mes - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

function fecha(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function etiqueta(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}
