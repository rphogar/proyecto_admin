import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parsearNumeroComprobante } from '@contave/fiscal-engine';
import { Asiento, type EntradaLinea, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, companies, documents, parties, periods, retentionsReceived } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalString,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

const CUENTA_RET_IVA_SOPORTADAS = '1.3.02';
const CUENTA_RET_ISLR_SOPORTADAS = '1.3.03';
const CUENTA_CLIENTES_VES = '1.2.01';
const CUENTA_CLIENTES_DIVISA = '1.2.02';

const TIPOS = ['IVA', 'ISLR'] as const;

interface EntradaRecibida {
  companyId: string;
  partyId: string;
  documentId: string | null;
  tipo: (typeof TIPOS)[number];
  numeroComprobante: string;
  conceptoIslr: string | null;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  baseOrigen: string;
  porcentaje: string;
  montoOrigen: string;
  fechaComprobante: Date;
  /** Fecha de recepción: define el período de imputación (caso 28). */
  fechaRecepcion: Date;
}

function parseRecibida(body: unknown): EntradaRecibida {
  const b = asRecord(body);
  const moneda = requireString(b.moneda, 'moneda', 12).toUpperCase();
  const esVes = moneda === 'VES';
  const compRaw = b.fechaComprobante ?? b.fecha;
  const fechaComprobante = compRaw == null || String(compRaw).trim() === '' ? new Date() : new Date(String(compRaw));
  if (Number.isNaN(fechaComprobante.getTime())) throw new BadRequestException(`fechaComprobante inválida: ${String(compRaw)}`);
  const recRaw = b.fechaRecepcion ?? compRaw;
  const fechaRecepcion = recRaw == null || String(recRaw).trim() === '' ? new Date() : new Date(String(recRaw));
  if (Number.isNaN(fechaRecepcion.getTime())) throw new BadRequestException(`fechaRecepcion inválida: ${String(recRaw)}`);

  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    partyId: requireUuid(b.partyId, 'partyId'),
    documentId: optionalUuid(b.documentId, 'documentId'),
    tipo: requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toUpperCase()),
    numeroComprobante: requireString(b.numeroComprobante, 'numeroComprobante', 20),
    conceptoIslr: optionalString(b.conceptoIslr, 'conceptoIslr', 60),
    moneda,
    rateBcv: esVes ? null : requireDecimal(b.rateBcv, 'rateBcv'),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    baseOrigen: requireDecimal(b.baseOrigen, 'baseOrigen', true),
    porcentaje: requireDecimal(b.porcentaje, 'porcentaje', true),
    montoOrigen: requireDecimal(b.montoOrigen, 'montoOrigen'),
    fechaComprobante,
    fechaRecepcion,
  };
}

export interface RetencionRecibidaRegistrada {
  retencion: typeof retentionsReceived.$inferSelect;
}

/**
 * Registro de comprobantes de retención RECIBIDOS (P9, docs/02 §3.3; casos 26 y 28). Transacción
 * única: asiento POSTED (D 1.3.02/1.3.03 retención soportada ; C Clientes — salda la porción
 * retenida de la CxC) → fila de `retentions_received` (inmutable) → auditoría.
 *
 * Imputación por período (caso 28): el período de imputación es el de la **fecha de recepción**, no
 * el de la fecha del comprobante; el asiento se registra en ese período (debe estar abierto).
 */
@Injectable()
export class RetencionesRecibidasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async registrar(body: unknown): Promise<RetencionRecibidaRegistrada> {
    const e = parseRecibida(body);
    if (parsearNumeroComprobante(e.numeroComprobante) === null) {
      // Solo advertencia de formato: algunos agentes usan numeraciones no normadas. No bloquea.
    }

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new NotFoundException(`Empresa ${e.companyId} no encontrada`);
      const agente = await cargarTercero(tx, e.partyId, e.companyId);
      if (e.documentId !== null) {
        await asegurarFactura(tx, e.documentId, e.companyId);
      }
      const cuentas = await cargarCuentas(tx, e.companyId);

      // Triple base del monto retenido.
      const monto = new Decimal(e.montoOrigen);
      const rateBcv = e.rateBcv === null ? null : new Decimal(e.rateBcv);
      const rateUsdMgmt = new Decimal(e.rateUsdMgmt);
      const montoVes = e.moneda === 'VES' ? monto : monto.times(rateBcv ?? new Decimal(0));
      const montoUsd = e.moneda === 'USD' ? monto : montoVes.div(rateUsdMgmt);
      const baseVes = e.moneda === 'VES' ? new Decimal(e.baseOrigen) : new Decimal(e.baseOrigen).times(rateBcv ?? new Decimal(0));

      // Período de imputación = período de la fecha de recepción (caso 28).
      const { anio, mes } = periodoFiscal(e.fechaRecepcion);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);

      const cuentaRet = e.tipo === 'IVA' ? CUENTA_RET_IVA_SOPORTADAS : CUENTA_RET_ISLR_SOPORTADAS;
      const cuentaClientes = e.moneda === 'VES' ? CUENTA_CLIENTES_VES : CUENTA_CLIENTES_DIVISA;
      const conRate = rateBcv !== null ? { rateBcv: rateBcv.toFixed() } : {};
      const lineas: EntradaLinea[] = [
        {
          cuenta: cuentaRet,
          dc: 'D',
          moneda: e.moneda,
          montoOrigen: monto.toFixed(),
          montoVes: montoVes.toFixed(),
          montoUsdMgmt: montoUsd.toFixed(),
          ...conRate,
          rateUsdMgmt: e.rateUsdMgmt,
        },
        {
          cuenta: cuentaClientes,
          dc: 'C',
          moneda: e.moneda,
          montoOrigen: monto.toFixed(),
          montoVes: montoVes.toFixed(),
          montoUsdMgmt: montoUsd.toFixed(),
          ...conRate,
          rateUsdMgmt: e.rateUsdMgmt,
          partyId: e.partyId,
        },
      ];
      const retId = randomUUID();
      const asiento = postear(
        Asiento.construir({
          fecha: e.fechaRecepcion,
          descripcion: `Retención ${e.tipo} recibida ${e.numeroComprobante} de ${agente.razonSocial}`,
          lineas,
          sourceType: 'RETENCION_RECIBIDA',
          estado: 'DRAFT',
          companyId: e.companyId,
          sourceId: retId,
        }),
      );
      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas,
      });

      const hash = createHash('sha256')
        .update(JSON.stringify({ retId, companyId: e.companyId, partyId: e.partyId, numero: e.numeroComprobante, montoVes: montoVes.toFixed(2) }))
        .digest('hex');

      const [retencion] = await tx
        .insert(retentionsReceived)
        .values({
          id: retId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          documentId: e.documentId,
          partyId: e.partyId,
          agenteRif: agente.rif,
          agenteNombre: agente.razonSocial,
          tipo: e.tipo,
          numeroComprobante: e.numeroComprobante,
          periodoAnio: anio,
          periodoMes: mes,
          conceptoIslr: e.conceptoIslr,
          currency: e.moneda,
          rateBcv: e.rateBcv,
          rateUsdMgmt: e.rateUsdMgmt,
          baseOrigen: e.baseOrigen,
          baseVes: baseVes.toFixed(8),
          porcentaje: e.porcentaje,
          montoOrigen: monto.toFixed(8),
          montoVes: montoVes.toFixed(8),
          montoUsdMgmt: montoUsd.toFixed(8),
          fechaComprobante: fechaFiscal(e.fechaComprobante),
          fechaRecepcion: fechaFiscal(e.fechaRecepcion),
          journalEntryId: entryId,
          hashIntegridad: hash,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (retencion === undefined) throw new Error('No se pudo registrar la retención recibida');

      await this.audit.registrar(tx, {
        accion: 'retencion.receive',
        entidad: 'retentions_received',
        entidadId: retId,
        after: retencion,
      });

      return { retencion };
    });
  }

  /** Lista comprobantes recibidos de la empresa. */
  async listar(companyId: string): Promise<(typeof retentionsReceived.$inferSelect)[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(retentionsReceived).where(eq(retentionsReceived.companyId, companyId));
    });
  }
}

async function cargarTercero(tx: DatabaseTx, partyId: string, companyId: string): Promise<typeof parties.$inferSelect> {
  const [row] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.companyId, companyId)))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Tercero ${partyId} no encontrado en la empresa`);
  return row;
}

async function asegurarFactura(tx: DatabaseTx, documentId: string, companyId: string): Promise<void> {
  const [row] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Factura ${documentId} no encontrada en la empresa`);
}

async function cargarCuentas(tx: DatabaseTx, companyId: string): Promise<Map<string, string>> {
  const filas = await tx.select({ id: accounts.id, codigo: accounts.codigo }).from(accounts).where(eq(accounts.companyId, companyId));
  return new Map(filas.map((f) => [f.codigo, f.id]));
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
