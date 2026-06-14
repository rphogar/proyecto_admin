import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Asiento, postear, reversar } from '@contave/ledger';
import { Decimal, periodoFiscal } from '@contave/shared';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, journalEntries, journalLines, revaluaciones } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularRevaluacion, type SaldoDivisa } from './calculo-revaluacion';
import { cargarCuentas, hashIntegridad, requerirPeriodoAbierto } from './tesoreria-comun';

interface RevaluarInput {
  companyId: string;
  anio: number;
  mes: number;
  rateCierre: string;
}

export type Revaluacion = typeof revaluaciones.$inferSelect;
export interface ResultadoRevaluacion {
  readonly revaluacion: Revaluacion;
  /** True si ya existía la corrida del período (idempotencia: no se duplicó nada — caso 11). */
  readonly yaEjecutada: boolean;
}

/**
 * Revaluación mensual de saldos en divisas (P11, docs/03 §4.2 "no realizado", caso 11). Deriva los
 * saldos en divisas del ledger, calcula el diferencial NO realizado a la tasa de cierre y postea el
 * asiento de ajuste (último día del mes) + su **reverso** (día 1 del mes siguiente). **Idempotente**:
 * la unicidad `(company, anio, mes)` hace que re-ejecutar sea un no-op (no duplica el ajuste); para
 * rehacerla con otra tasa hay que reversar la corrida del período primero.
 */
@Injectable()
export class RevaluacionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async ejecutar(body: unknown): Promise<ResultadoRevaluacion> {
    const e = parse(body);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      // Idempotencia (caso 11): si ya existe la corrida del período, no se duplica.
      const [existente] = await tx
        .select()
        .from(revaluaciones)
        .where(and(eq(revaluaciones.companyId, e.companyId), eq(revaluaciones.anio, e.anio), eq(revaluaciones.mes, e.mes)))
        .limit(1);
      if (existente !== undefined) {
        return { revaluacion: existente, yaEjecutada: true };
      }

      const { porCodigo } = await cargarCuentas(tx, e.companyId);
      const saldos = await saldosDivisa(tx, e.companyId);

      const corte = ultimoDiaUtc(e.anio, e.mes);
      const dia1Siguiente = primerDiaSiguienteUtc(e.anio, e.mes);
      const revaluacionId = randomUUID();
      const resultado = calcularRevaluacion({
        fecha: corte,
        descripcion: `Revaluación de saldos en divisas ${e.anio}-${String(e.mes).padStart(2, '0')}`,
        saldos,
        rateCierre: e.rateCierre,
        companyId: e.companyId,
        sourceId: revaluacionId,
      });

      let entryId: string | null = null;
      let reversoId: string | null = null;
      if (resultado.entradaAsiento !== undefined) {
        const periodId = await requerirPeriodoAbierto(tx, e.companyId, e.anio, e.mes);
        const { anio: anioSig, mes: mesSig } = periodoFiscal(dia1Siguiente);
        const periodSiguiente = await requerirPeriodoAbierto(tx, e.companyId, anioSig, mesSig);

        const ajusteId = randomUUID();
        const ajuste = postear(Asiento.construir({ ...resultado.entradaAsiento, id: ajusteId }));
        entryId = await persistirAsiento(tx, ajuste, { tenantId: ctx.tenantId, companyId: e.companyId, periodId, createdBy: ctx.userId ?? null, cuentas: porCodigo });

        // Reverso automático el día 1 del mes siguiente (el ajuste no realizado se revierte).
        const reversoEntryId = randomUUID();
        const reverso = postear(reversar(ajuste, { fecha: dia1Siguiente, id: reversoEntryId, descripcion: `Reverso revaluación ${e.anio}-${String(e.mes).padStart(2, '0')}` }));
        reversoId = await persistirAsiento(tx, reverso, { tenantId: ctx.tenantId, companyId: e.companyId, periodId: periodSiguiente, createdBy: ctx.userId ?? null, cuentas: porCodigo });
      }

      const hash = hashIntegridad({ revaluacionId, companyId: e.companyId, anio: e.anio, mes: e.mes, entryId, reversoId, diferencial: resultado.diferencialVes });
      const [fila] = await tx
        .insert(revaluaciones)
        .values({
          id: revaluacionId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          anio: e.anio,
          mes: e.mes,
          fechaCorte: corte.toISOString().slice(0, 10),
          rateCierre: e.rateCierre,
          journalEntryId: entryId,
          reversoEntryId: reversoId,
          diferencialVes: resultado.diferencialVes,
          status: 'POSTED',
          hash,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo registrar la revaluación');

      await this.audit.registrar(tx, { accion: 'tesoreria.revaluar', entidad: 'revaluaciones', entidadId: revaluacionId, after: fila });
      return { revaluacion: fila, yaEjecutada: false };
    });
  }

  async listar(companyId: string): Promise<Revaluacion[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(revaluaciones).where(eq(revaluaciones.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parse(body: unknown): RevaluarInput {
  const b = asRecord(body);
  const anio = optionalInt(b.anio, 'anio', 0, 2000);
  const mes = optionalInt(b.mes, 'mes', 0, 1);
  if (anio < 2000 || mes < 1 || mes > 12) throw new BadRequestException('anio/mes inválidos');
  return { companyId: requireUuid(b.companyId, 'companyId'), anio, mes, rateCierre: requireDecimal(b.rateCierre, 'rateCierre') };
}

/** Saldos en divisas (cuentas con `moneda` ≠ VES) derivados del ledger: origen y VES en libros. */
async function saldosDivisa(tx: DatabaseTx, companyId: string): Promise<SaldoDivisa[]> {
  const filas = await tx
    .select({ codigo: accounts.codigo, moneda: accounts.moneda, dc: journalLines.dc, montoOrigen: journalLines.montoOrigen, montoVes: journalLines.montoVes, lineaMoneda: journalLines.moneda })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalEntries.estado, 'POSTED'), isNotNull(accounts.moneda), ne(accounts.moneda, 'VES')));

  const acc = new Map<string, { codigo: string; moneda: string; netoOrigen: Decimal; netoVes: Decimal }>();
  for (const f of filas) {
    const m = acc.get(f.codigo) ?? { codigo: f.codigo, moneda: f.moneda ?? 'USD', netoOrigen: new Decimal(0), netoVes: new Decimal(0) };
    const signo = f.dc === 'D' ? 1 : -1;
    // El origen solo cuenta si la línea está en la moneda de la cuenta (los ajustes VES tienen origen 0).
    if (f.lineaMoneda.toUpperCase() === (f.moneda ?? '').toUpperCase()) {
      m.netoOrigen = m.netoOrigen.plus(new Decimal(f.montoOrigen).times(signo));
    }
    m.netoVes = m.netoVes.plus(new Decimal(f.montoVes).times(signo));
    acc.set(f.codigo, m);
  }

  const saldos: SaldoDivisa[] = [];
  for (const v of acc.values()) {
    if (v.netoOrigen.abs().lte('0.0000001')) continue;
    saldos.push({
      cuenta: v.codigo,
      moneda: v.moneda,
      lado: v.netoOrigen.isNegative() ? 'C' : 'D',
      saldoOrigen: v.netoOrigen.abs().toFixed(8),
      vesEnLibros: v.netoVes.abs().toFixed(8),
    });
  }
  return saldos;
}

function ultimoDiaUtc(anio: number, mes: number): Date {
  const dia = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // día 0 del mes siguiente = último del mes
  return new Date(Date.UTC(anio, mes - 1, dia, 20, 0, 0)); // 20:00Z ≈ 16:00 Caracas, mismo día civil
}

function primerDiaSiguienteUtc(anio: number, mes: number): Date {
  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig = mes === 12 ? 1 : mes + 1;
  return new Date(Date.UTC(anioSig, mesSig - 1, 1, 20, 0, 0));
}
