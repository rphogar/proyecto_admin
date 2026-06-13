import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AlicuotaCodigo,
  calcularIgtf,
  type DocumentoAEmitir,
  type Incumplimiento,
  validarRequisitosFactura,
} from '@contave/fiscal-engine';
import { fechaFiscal } from '@contave/shared';
import { and, desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, documentLines, documentTaxes, documents, parties } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireEnum, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularDocumento, type DocumentoCalculado } from './calculo-documento';
import { type DocumentoEmitido, EmisionService, type EntradaEmision, parseEmision } from './emision.service';

/** Documento con su detalle (cabecera + líneas + impuestos). */
export interface DocumentoConDetalle {
  documento: typeof documents.$inferSelect;
  lineas: (typeof documentLines.$inferSelect)[];
  impuestos: (typeof documentTaxes.$inferSelect)[];
}

/** Resultado del cálculo en vivo (regla 3: la UI nunca calcula). */
export interface ResultadoCalculo {
  calculo: DocumentoCalculado;
  incumplimientos: Incumplimiento[];
  /** IGTF estimado para el panel de totales (si se indicó un pago en divisas). */
  igtfEstimadoVes: string | null;
}

/**
 * Servicio de documentos de venta (P8): cálculo en vivo (sin persistir), ciclo de BORRADOR
 * (DRAFT: crear/editar/listar/ver/eliminar) y emisión desde un borrador. La emisión transaccional
 * (correlativo, asiento, inmutabilidad, auditoría) la hace {@link EmisionService}; aquí se orquesta
 * el borrador, que es mutable hasta emitirse (el trigger de inmutabilidad solo bloquea ISSUED/APPLIED).
 */
@Injectable()
export class DocumentosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly emision: EmisionService,
    private readonly audit: AuditService,
  ) {}

  /** Cálculo en vivo del documento: totales por alícuota, validador 00071/00102 e IGTF estimado. */
  async calcular(body: unknown): Promise<ResultadoCalculo> {
    const e = parseEmision(body);
    const b = asRecord(body);
    const calculo = calcularDocumento({
      tipo: e.tipo,
      moneda: e.moneda,
      rateBcv: e.rateBcv,
      rateUsdMgmt: e.rateUsdMgmt,
      lineas: e.lineas,
    });

    // IGTF estimado: el pago en divisas se indica en `pagosEstimados`; se asume perceptor salvo
    // indicación contraria (el panel muestra "lo que costaría si pagas en divisas").
    const igtf = calcularIgtf({
      metodos: parsePagosEstimados(b.pagosEstimados),
      empresaEsPerceptor: b.empresaEsPerceptor !== false,
    });

    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const company = await cargarEmpresa(tx, e.companyId);
      const party = e.partyId !== null ? await cargarTercero(tx, e.partyId, e.companyId) : null;
      const incumplimientos = validarRequisitosFactura(construirProyeccion(e, company, party, calculo));
      return { calculo, incumplimientos, igtfEstimadoVes: igtf.igtfTotalVes };
    });
  }

  /** Crea un BORRADOR (DRAFT): sin número ni asiento; mutable hasta emitirse. */
  async crearBorrador(body: unknown): Promise<DocumentoConDetalle> {
    const e = parseEmision(body);
    const calc = calcularDocumento({
      tipo: e.tipo,
      moneda: e.moneda,
      rateBcv: e.rateBcv,
      rateUsdMgmt: e.rateUsdMgmt,
      lineas: e.lineas,
    });
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const docId = randomUUID();
      const documento = await insertarBorrador(tx, docId, e, calc, { tenantId: ctx.tenantId, userId: ctx.userId ?? null });
      const { lineas, impuestos } = await insertarHijos(tx, docId, e, calc, ctx);
      await this.audit.registrar(tx, { accion: 'document.draft', entidad: 'documents', entidadId: docId, after: documento });
      return { documento, lineas, impuestos };
    });
  }

  /** Actualiza un BORRADOR existente (reemplaza líneas/impuestos y recalcula). */
  async actualizarBorrador(id: string, body: unknown): Promise<DocumentoConDetalle> {
    const e = parseEmision(body);
    const calc = calcularDocumento({
      tipo: e.tipo,
      moneda: e.moneda,
      rateBcv: e.rateBcv,
      rateUsdMgmt: e.rateUsdMgmt,
      lineas: e.lineas,
    });
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const prev = await cargarDocumento(tx, id);
      if (prev.status !== 'DRAFT') {
        throw new BadRequestException('Solo se puede editar un documento en BORRADOR; lo emitido es inmutable (regla 4)');
      }
      // Reemplazar hijos (permitido mientras el padre sea DRAFT) y actualizar la cabecera.
      await tx.delete(documentTaxes).where(eq(documentTaxes.documentId, id));
      await tx.delete(documentLines).where(eq(documentLines.documentId, id));
      const [documento] = await tx
        .update(documents)
        .set({
          seriesId: e.seriesId,
          type: e.tipo,
          branchId: e.branchId,
          partyId: e.partyId,
          partyRif: e.adquirenteRif,
          partyNombre: e.adquirenteNombre,
          currency: e.moneda,
          rateBcv: e.rateBcv,
          rateUsdMgmt: e.rateUsdMgmt,
          exchangeRateId: e.exchangeRateId,
          paymentCondition: e.paymentCondition,
          medioEmision: e.medioEmision,
          controlNumber: e.numeroControl,
          affectedDocumentId: e.affectedDocumentId,
          issueDate: e.issueDate,
          issueFechaFiscal: fechaFiscal(e.issueDate),
          totalOrigen: calc.totales.totalOrigen,
          totalVes: calc.totales.totalVes,
          totalUsdMgmt: calc.totales.totalUsdMgmt,
        })
        .where(eq(documents.id, id))
        .returning();
      if (documento === undefined) throw new NotFoundException(`Borrador ${id} no encontrado`);
      const { lineas, impuestos } = await insertarHijos(tx, id, e, calc, ctx);
      return { documento, lineas, impuestos };
    });
  }

  /** Lista documentos de la empresa, con filtros opcionales por tipo y estado. */
  async listar(query: Record<string, unknown>): Promise<(typeof documents.$inferSelect)[]> {
    const companyId = requireUuid(query.companyId, 'companyId');
    const tipo = optionalString(query.type, 'type', 40);
    const status = optionalString(query.status, 'status', 20);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const conds = [eq(documents.companyId, companyId)];
      if (tipo !== null) conds.push(eq(documents.type, tipo));
      if (status !== null) conds.push(eq(documents.status, status));
      return tx.select().from(documents).where(and(...conds)).orderBy(desc(documents.createdAt));
    });
  }

  /** Devuelve un documento con su detalle. */
  async obtener(id: string): Promise<DocumentoConDetalle> {
    return withTenant(this.database.db, async (tx) => {
      const documento = await cargarDocumento(tx, id);
      const lineas = await tx
        .select()
        .from(documentLines)
        .where(eq(documentLines.documentId, id))
        .orderBy(documentLines.lineaNo);
      const impuestos = await tx.select().from(documentTaxes).where(eq(documentTaxes.documentId, id));
      return { documento, lineas, impuestos };
    });
  }

  /** Elimina un BORRADOR (cascada a líneas/impuestos). Lo emitido no se borra (regla 4). */
  async eliminar(id: string): Promise<void> {
    await withTenant(this.database.db, async (tx) => {
      const prev = await cargarDocumento(tx, id);
      if (prev.status !== 'DRAFT') {
        throw new BadRequestException('Solo se puede eliminar un borrador; lo emitido es inmutable (regla 4)');
      }
      await this.audit.registrar(tx, { accion: 'document.draft.delete', entidad: 'documents', entidadId: id, before: prev });
      await tx.delete(documents).where(eq(documents.id, id));
    });
  }

  /** Emite un BORRADOR: reconstruye el cuerpo de emisión y delega en la transacción de emisión. */
  async emitirBorrador(id: string): Promise<DocumentoEmitido> {
    const borrador = await this.obtener(id);
    if (borrador.documento.status !== 'DRAFT') {
      throw new BadRequestException('El documento ya fue emitido');
    }
    const emitido = await this.emision.emitir(cuerpoDesdeBorrador(borrador));
    // El borrador se reemplaza por el documento emitido (id nuevo); se elimina el DRAFT.
    await this.eliminar(id);
    return emitido;
  }
}

// ── Helpers de persistencia y carga (todo bajo RLS dentro de la transacción) ──────

async function cargarEmpresa(tx: DatabaseTx, companyId: string): Promise<typeof companies.$inferSelect> {
  const [row] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (row === undefined) throw new NotFoundException(`Empresa ${companyId} no encontrada`);
  return row;
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

async function cargarDocumento(tx: DatabaseTx, id: string): Promise<typeof documents.$inferSelect> {
  const [row] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (row === undefined) throw new NotFoundException(`Documento ${id} no encontrado`);
  return row;
}

async function insertarBorrador(
  tx: DatabaseTx,
  docId: string,
  e: EntradaEmision,
  calc: DocumentoCalculado,
  ctx: { tenantId: string; userId?: string | null },
): Promise<typeof documents.$inferSelect> {
  const [documento] = await tx
    .insert(documents)
    .values({
      id: docId,
      tenantId: ctx.tenantId,
      companyId: e.companyId,
      branchId: e.branchId,
      type: e.tipo,
      seriesId: e.seriesId,
      number: null,
      controlNumber: e.numeroControl,
      status: 'DRAFT',
      medioEmision: e.medioEmision,
      partyId: e.partyId,
      partyRif: e.adquirenteRif,
      partyNombre: e.adquirenteNombre,
      issueDate: e.issueDate,
      issueFechaFiscal: fechaFiscal(e.issueDate),
      currency: e.moneda,
      exchangeRateId: e.exchangeRateId,
      rateBcv: e.rateBcv,
      rateUsdMgmt: e.rateUsdMgmt,
      paymentCondition: e.paymentCondition,
      affectedDocumentId: e.affectedDocumentId,
      totalOrigen: calc.totales.totalOrigen,
      totalVes: calc.totales.totalVes,
      totalUsdMgmt: calc.totales.totalUsdMgmt,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  if (documento === undefined) throw new Error('No se pudo crear el borrador');
  return documento;
}

async function insertarHijos(
  tx: DatabaseTx,
  docId: string,
  e: EntradaEmision,
  calc: DocumentoCalculado,
  ctx: { tenantId: string },
): Promise<{ lineas: (typeof documentLines.$inferSelect)[]; impuestos: (typeof documentTaxes.$inferSelect)[] }> {
  const lineas = await tx
    .insert(documentLines)
    .values(
      calc.lineas.map((l) => ({
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        documentId: docId,
        lineaNo: l.lineaNo,
        itemId: l.itemId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioOrigen: l.precioUnitarioOrigen,
        descuentoOrigen: l.descuentoOrigen,
        alicuotaCodigo: l.alicuotaCodigo,
        alicuotaTasa: l.alicuotaTasa,
        baseOrigen: l.baseOrigen,
        baseVes: l.baseVes,
        baseUsdMgmt: l.baseUsdMgmt,
        ivaOrigen: l.ivaOrigen,
        ivaVes: l.ivaVes,
        ivaUsdMgmt: l.ivaUsdMgmt,
      })),
    )
    .returning();
  const impuestos = await tx
    .insert(documentTaxes)
    .values(
      calc.impuestos.map((t) => ({
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        documentId: docId,
        alicuotaCodigo: t.alicuotaCodigo,
        alicuotaTasa: t.alicuotaTasa,
        baseOrigen: t.baseOrigen,
        baseVes: t.baseVes,
        baseUsdMgmt: t.baseUsdMgmt,
        montoOrigen: t.montoOrigen,
        montoVes: t.montoVes,
        montoUsdMgmt: t.montoUsdMgmt,
      })),
    )
    .returning();
  return { lineas, impuestos };
}

/** Reconstruye el cuerpo de `EmisionService.emitir` a partir de un borrador con su detalle. */
function cuerpoDesdeBorrador(b: DocumentoConDetalle): Record<string, unknown> {
  const d = b.documento;
  return {
    companyId: d.companyId,
    seriesId: d.seriesId,
    tipo: d.type,
    branchId: d.branchId,
    moneda: d.currency,
    rateBcv: d.rateBcv,
    rateUsdMgmt: d.rateUsdMgmt,
    exchangeRateId: d.exchangeRateId,
    medioEmision: d.medioEmision,
    numeroControl: d.controlNumber,
    paymentCondition: d.paymentCondition,
    issueDate: d.issueDate,
    partyId: d.partyId,
    adquirenteRif: d.partyRif,
    adquirenteNombre: d.partyNombre,
    affectedDocumentId: d.affectedDocumentId,
    lineas: b.lineas
      .slice()
      .sort((a, z) => a.lineaNo - z.lineaNo)
      .map((l) => ({
        itemId: l.itemId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioOrigen: l.precioUnitarioOrigen,
        descuentoOrigen: l.descuentoOrigen,
        alicuotaCodigo: l.alicuotaCodigo,
        alicuotaTasa: l.alicuotaTasa,
      })),
  };
}

/** Proyección para el validador pre-emisión (importes en moneda origen). */
function construirProyeccion(
  e: EntradaEmision,
  company: typeof companies.$inferSelect,
  party: typeof parties.$inferSelect | null,
  calc: DocumentoCalculado,
): DocumentoAEmitir {
  return {
    tipo: e.tipo,
    medioEmision: e.medioEmision,
    emisor: { razonSocial: company.razonSocial, rif: company.rif, domicilioFiscal: company.direccionFiscal },
    numeroControl: e.numeroControl,
    adquirente: {
      esConsumidorFinal: party === null,
      rif: party?.rif ?? e.adquirenteRif,
      nombre: party?.razonSocial ?? e.adquirenteNombre,
      condicionIva: (party?.condicionIva as DocumentoAEmitir['adquirente']['condicionIva']) ?? 'no_contribuyente',
    },
    fechaEmision: e.issueDate.toISOString(),
    moneda: e.moneda,
    rateBcv: e.rateBcv,
    totalVes: calc.totales.totalVes,
    condicionPago: e.paymentCondition,
    lineas: e.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitarioOrigen,
      alicuotaCodigo: l.alicuotaCodigo as AlicuotaCodigo,
      alicuotaTasa: l.alicuotaTasa,
    })),
    impuestos: calc.impuestos.map((t) => ({
      alicuotaCodigo: t.alicuotaCodigo,
      alicuotaTasa: t.alicuotaTasa,
      base: t.baseOrigen,
      monto: t.montoOrigen,
    })),
    total: calc.totales.totalOrigen,
    ...(e.umbralConsumidorFinalVes !== null ? { umbralConsumidorFinalVes: e.umbralConsumidorFinalVes } : {}),
  };
}

/** Parsea los pagos estimados para el IGTF del panel en vivo (tolerante: lista opcional). */
function parsePagosEstimados(raw: unknown): { moneda: never; montoOrigen: string; esDivisa: boolean; rateBcv: string | null }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const o = asRecord(p);
    return {
      moneda: requireEnum(o.moneda, 'pagosEstimados[].moneda', ['VES', 'USD', 'EUR', 'USDT'] as const, (s) => s.toUpperCase()) as never,
      montoOrigen: String(o.montoOrigen ?? '0'),
      esDivisa: o.esDivisa === true,
      rateBcv: o.rateBcv == null ? null : String(o.rateBcv),
    };
  });
}
