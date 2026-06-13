import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Asiento, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import {
  accounts,
  cobroAplicaciones,
  cobroMedios,
  cobros,
  companies,
  documents,
  paymentMethods,
  periods,
} from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalDecimal, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularCobro, type EntradaCobro, type MedioCobro, type VueltoCobro } from './calculo-cobro';

const CUENTA_CXC_VES = '1.2.01';
const CUENTA_CXC_DIVISA = '1.2.02';

interface MedioInput {
  paymentMethodId: string;
  montoOrigen: string;
  rateBcv: string | null;
}

interface EntradaCobroDto {
  companyId: string;
  documentId: string;
  fecha: Date;
  rateUsdMgmt: string;
  medios: MedioInput[];
  vuelto: MedioInput[];
}

function parseMedio(raw: unknown, i: number, campo: string): MedioInput {
  const b = asRecord(raw);
  return {
    paymentMethodId: requireUuid(b.paymentMethodId, `${campo}[${i}].paymentMethodId`),
    montoOrigen: requireDecimal(b.montoOrigen, `${campo}[${i}].montoOrigen`),
    rateBcv: optionalDecimal(b.rateBcv, `${campo}[${i}].rateBcv`),
  };
}

function parseCobro(body: unknown): EntradaCobroDto {
  const b = asRecord(body);
  if (!Array.isArray(b.medios) || b.medios.length === 0) {
    throw new BadRequestException('El cobro requiere al menos un método de pago');
  }
  const fechaRaw = b.fecha ?? b.issueDate;
  const fecha = fechaRaw == null || String(fechaRaw).trim() === '' ? new Date() : new Date(String(fechaRaw));
  if (Number.isNaN(fecha.getTime())) throw new BadRequestException(`fecha inválida: ${String(fechaRaw)}`);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    documentId: requireUuid(b.documentId, 'documentId'),
    fecha,
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    medios: b.medios.map((m, i) => parseMedio(m, i, 'medios')),
    vuelto: Array.isArray(b.vuelto) ? b.vuelto.map((v, i) => parseMedio(v, i, 'vuelto')) : [],
  };
}

/** Cobro con su detalle. */
export interface CobroRegistrado {
  cobro: typeof cobros.$inferSelect;
  medios: (typeof cobroMedios.$inferSelect)[];
  aplicaciones: (typeof cobroAplicaciones.$inferSelect)[];
}

/**
 * Registro de cobros (P8, docs/06 M3, docs/03 §4.2). Transacción única: cálculo del cobro (IGTF,
 * diferencial cambiario, vuelto) → asiento POSTED → cobro + medios + aplicaciones → auditoría. Todo
 * bajo RLS (`withTenant`). El cobro posteado es inmutable (regla 4).
 */
@Injectable()
export class CobrosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async registrar(body: unknown): Promise<CobroRegistrado> {
    const e = parseCobro(body);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new NotFoundException(`Empresa ${e.companyId} no encontrada`);
      const factura = await cargarFactura(tx, e.documentId, e.companyId);
      const metodos = await cargarMetodos(tx, e.companyId);
      const { porCodigo, porId } = await cargarCuentas(tx, e.companyId);

      const medios: MedioCobro[] = e.medios.map((m) => {
        const { cuenta, moneda, montoOrigen, rateBcv, causaIgtf } = resolverMedio(m, metodos, porId);
        return { cuenta, moneda, montoOrigen, rateBcv, esDivisa: causaIgtf };
      });
      const vuelto: VueltoCobro[] = e.vuelto.map((v) => {
        const { cuenta, moneda, montoOrigen, rateBcv } = resolverMedio(v, metodos, porId);
        return { cuenta, moneda, montoOrigen, rateBcv };
      });

      const cxcCuenta = factura.currency === 'VES' ? CUENTA_CXC_VES : CUENTA_CXC_DIVISA;
      const resultado = calcularCobro({
        fecha: e.fecha,
        descripcion: `Cobro factura ${factura.number ?? ''} (${factura.currency})`,
        saldo: {
          cuenta: cxcCuenta,
          moneda: factura.currency,
          rateCarryBcv: factura.rateBcv,
          partyId: factura.partyId,
        },
        medios,
        vuelto,
        empresaEsPerceptor: company.spe,
        rateUsdMgmt: e.rateUsdMgmt,
        companyId: e.companyId,
      } satisfies EntradaCobro);

      // Período abierto + asiento POSTED.
      const { anio, mes } = periodoFiscal(e.fecha);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);
      const cobroId = randomUUID();
      const entrada = { ...resultado.entradaAsiento, sourceId: cobroId };
      const asiento = postear(Asiento.construir(entrada));
      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas: porCodigo,
      });

      // Totales del cobro = lo aplicado a la CxC (en la moneda de la factura).
      const aplicadoVes = new Decimal(resultado.aplicadoVes);
      const rateCarry = factura.rateBcv === null ? null : new Decimal(factura.rateBcv);
      const aplicadoOrigen = factura.currency === 'VES' || rateCarry === null ? aplicadoVes : aplicadoVes.div(rateCarry);
      const aplicadoUsd = aplicadoVes.div(e.rateUsdMgmt);

      const hash = createHash('sha256')
        .update(JSON.stringify({ cobroId, companyId: e.companyId, documentId: e.documentId, entryId, aplicadoVes: aplicadoVes.toFixed(2) }))
        .digest('hex');

      const [cobro] = await tx
        .insert(cobros)
        .values({
          id: cobroId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          branchId: factura.branchId,
          partyId: factura.partyId,
          fecha: e.fecha,
          fechaFiscal: fechaFiscal(e.fecha),
          journalEntryId: entryId,
          igtfTotalVes: resultado.igtf.igtfTotalVes,
          totalOrigen: aplicadoOrigen.toFixed(8),
          totalVes: aplicadoVes.toFixed(8),
          totalUsdMgmt: aplicadoUsd.toFixed(8),
          hashIntegridad: hash,
          status: 'POSTED',
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (cobro === undefined) throw new Error('No se pudo registrar el cobro');

      const mediosFilas = [...e.medios.map((m) => ({ m, esVuelto: false })), ...e.vuelto.map((m) => ({ m, esVuelto: true }))];
      const mediosInsert = await tx
        .insert(cobroMedios)
        .values(
          mediosFilas.map(({ m, esVuelto }) => {
            const pm = metodos.get(m.paymentMethodId)!;
            const t = expandir(m.montoOrigen, pm.moneda, m.rateBcv, e.rateUsdMgmt);
            return {
              tenantId: ctx.tenantId,
              companyId: e.companyId,
              cobroId,
              paymentMethodId: m.paymentMethodId,
              moneda: pm.moneda,
              montoOrigen: m.montoOrigen,
              rateBcv: m.rateBcv,
              montoVes: t.ves,
              montoUsdMgmt: t.usd,
              causaIgtf: pm.causaIgtf,
              esVuelto,
            };
          }),
        )
        .returning();

      const aplicaciones = await tx
        .insert(cobroAplicaciones)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          cobroId,
          documentId: e.documentId,
          montoAplicadoOrigen: aplicadoOrigen.toFixed(8),
          montoAplicadoVes: aplicadoVes.toFixed(8),
          montoAplicadoUsdMgmt: aplicadoUsd.toFixed(8),
        })
        .returning();

      await this.audit.registrar(tx, { accion: 'cobro.create', entidad: 'cobros', entidadId: cobroId, after: cobro });

      return { cobro, medios: mediosInsert, aplicaciones };
    });
  }

  /** Lista cobros de la empresa. */
  async listar(companyId: string): Promise<(typeof cobros.$inferSelect)[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(cobros).where(eq(cobros.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MetodoInfo {
  cuentaId: string;
  causaIgtf: boolean;
  moneda: string;
}

function resolverMedio(
  m: MedioInput,
  metodos: Map<string, MetodoInfo>,
  porId: Map<string, string>,
): { cuenta: string; moneda: string; montoOrigen: string; rateBcv: string | null; causaIgtf: boolean } {
  const pm = metodos.get(m.paymentMethodId);
  if (pm === undefined) throw new BadRequestException(`Método de pago ${m.paymentMethodId} no encontrado en la empresa`);
  const cuenta = porId.get(pm.cuentaId);
  if (cuenta === undefined) throw new Error(`La cuenta ${pm.cuentaId} del método de pago no está en el plan`);
  return { cuenta, moneda: pm.moneda, montoOrigen: m.montoOrigen, rateBcv: m.rateBcv, causaIgtf: pm.causaIgtf };
}

function expandir(montoOrigen: string, moneda: string, rateBcv: string | null, rateUsdMgmt: string): { ves: string; usd: string } {
  const monto = new Decimal(montoOrigen);
  const m = moneda.trim().toUpperCase();
  const ves = m === 'VES' ? monto : monto.times(new Decimal(rateBcv ?? '0'));
  const usd = m === 'USD' ? monto : ves.div(new Decimal(rateUsdMgmt));
  return { ves: ves.toFixed(8), usd: usd.toFixed(8) };
}

async function cargarFactura(tx: DatabaseTx, id: string, companyId: string): Promise<typeof documents.$inferSelect> {
  const [row] = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Factura ${id} no encontrada en la empresa`);
  if (row.status !== 'ISSUED' && row.status !== 'APPLIED') {
    throw new BadRequestException('Solo se cobran documentos emitidos');
  }
  return row;
}

async function cargarMetodos(tx: DatabaseTx, companyId: string): Promise<Map<string, MetodoInfo>> {
  const filas = await tx
    .select({ id: paymentMethods.id, cuentaId: paymentMethods.cuentaId, causaIgtf: paymentMethods.causaIgtf, moneda: paymentMethods.moneda })
    .from(paymentMethods)
    .where(eq(paymentMethods.companyId, companyId));
  return new Map(filas.map((f) => [f.id, { cuentaId: f.cuentaId, causaIgtf: f.causaIgtf, moneda: f.moneda }]));
}

async function cargarCuentas(
  tx: DatabaseTx,
  companyId: string,
): Promise<{ porCodigo: Map<string, string>; porId: Map<string, string> }> {
  const filas = await tx.select({ id: accounts.id, codigo: accounts.codigo }).from(accounts).where(eq(accounts.companyId, companyId));
  return {
    porCodigo: new Map(filas.map((f) => [f.codigo, f.id])),
    porId: new Map(filas.map((f) => [f.id, f.codigo])),
  };
}

async function requerirPeriodoAbierto(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<string> {
  const [row] = await tx
    .select({ id: periods.id, estado: periods.estado })
    .from(periods)
    .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
    .limit(1);
  if (row === undefined) {
    throw new BadRequestException(`No existe período contable ${anio}-${String(mes).padStart(2, '0')} para la empresa`);
  }
  if (row.estado === 'CLOSED') throw new BadRequestException(`El período ${anio}-${String(mes).padStart(2, '0')} está cerrado (regla 9)`);
  return row.id;
}
