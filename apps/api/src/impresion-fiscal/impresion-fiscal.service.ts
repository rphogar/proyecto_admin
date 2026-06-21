import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AdquirenteImpresion,
  type ComandoFiscal,
  type DocumentoParaImpresion,
  type ImpresoraFiscal,
  type LineaImpresion,
  type MedioPagoImpresion,
  mapearDocumentoAComandos,
  type RangoMemoria,
  type ResultadoImpresion,
} from '@contave/impresora-fiscal';
import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { proximoIntento as calcularProximoIntento } from '../cumplimiento/backoff';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { fiscalPrintQueue, parties } from '../db/schema';
import { type DocumentoEmitido, EmisionService, type EntradaEmision, parseEmision } from '../documentos/emision.service';
import { DocumentosService } from '../documentos/documentos.service';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalInt, optionalString, optionalUuid, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { IMPRESORA_FISCAL } from './impresora-fiscal.adapter';

export type FilaPrintJob = typeof fiscalPrintQueue.$inferSelect;

/** Trabajo que el agente local reclama: id + comandos fiscales a ejecutar en el hardware. */
export interface TrabajoReclamado {
  id: string;
  comandos: ComandoFiscal[];
}

/** Resultado de una impresión directa (con el adapter en proceso, sin agente). */
export interface ResultadoImpresionDirecta {
  job: FilaPrintJob;
  documento: DocumentoEmitido | null;
}

/**
 * Cola de impresión hacia la máquina fiscal (P23, docs/05 §5). La API SaaS **no habla con el hardware**:
 * `solicitarImpresion` valida, mapea el documento a comandos fiscales y encola el trabajo; un **agente
 * local** lo `reclamar`a, lo imprime por serie/USB y `reportarResultado`. La numeración la asigna la
 * memoria fiscal (decisión P23): al confirmarse la impresión (IMPRESO), el documento se EMITE con el
 * número/control del hardware (vía {@link EmisionService}, que registra EMISION + IMPRESION en la
 * bitácora); en **contingencia** (impresora caída) el trabajo queda PENDIENTE reintentándose con
 * backoff y se registra un evento FALLO, sin consumir correlativo ni romper atomicidad.
 *
 * `imprimirDirecto` usa el adapter inyectado (simulado en CI / despliegue sin agente) para cerrar el
 * ciclo en proceso: útil en pruebas y demo. Reportes X/Z y memoria fiscal pasan por el adapter y se
 * auditan.
 */
@Injectable()
export class ImpresionFiscalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly emision: EmisionService,
    private readonly documentos: DocumentosService,
    private readonly fiscalEventLog: FiscalEventLogService,
    private readonly audit: AuditService,
    @Inject(IMPRESORA_FISCAL) private readonly adapter: ImpresoraFiscal,
  ) {}

  /**
   * Encola un documento para impresión en la máquina fiscal. Valida (00071/00102) y mapea a comandos
   * ANTES de encolar: un documento inválido no llega al hardware. No crea documento ni consume serie:
   * la venta no queda fiscalmente cerrada hasta el acuse de impresión (decisión P23).
   */
  async solicitarImpresion(body: unknown): Promise<FilaPrintJob> {
    const e = parseEmision(body);
    if (e.tipo !== 'FACTURA') {
      // TODO-TRIBUTARISTA: NC/ND por máquina fiscal (requiere referencia a la factura fiscal afectada
      // y el flujo de devolución del hardware). El mapeo del paquete ya las soporta.
      throw new BadRequestException('La máquina fiscal solo emite FACTURA en esta iteración (NC/ND: pendiente)');
    }
    if (e.moneda !== 'VES') {
      // TODO-TRIBUTARISTA: la máquina fiscal homologada opera en Bs; documentos en divisa requieren
      // política de conversión a la moneda fiscal antes de imprimir.
      throw new BadRequestException('La máquina fiscal opera en bolívares (VES); el soporte en divisa queda pendiente');
    }

    const { calculo, incumplimientos } = await this.documentos.calcular(body);
    if (incumplimientos.length > 0) {
      throw new BadRequestException({ message: 'El documento no cumple los requisitos de emisión (00071/00102)', incumplimientos });
    }

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const adquirente = await this.resolverAdquirente(tx, e);
      const doc: DocumentoParaImpresion = {
        tipo: 'FACTURA',
        adquirente,
        lineas: e.lineas.map(aLineaImpresion),
        mediosPago: parseMediosPago(body, calculo.totales.totalVes),
      };
      const comandos = mapearDocumentoAComandos(doc);
      const [fila] = await tx
        .insert(fiscalPrintQueue)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          payload: { emision: emisionBodyDesde(e), documento: doc, comandos } as object,
          estado: 'PENDIENTE',
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo encolar la impresión fiscal');
      return fila;
    });
  }

  /**
   * Cierra el ciclo en proceso usando el adapter inyectado (sin agente): encola, imprime con la
   * máquina (simulada en CI) y procesa el desenlace. Útil para pruebas y para despliegues sin agente.
   */
  async imprimirDirecto(body: unknown): Promise<ResultadoImpresionDirecta> {
    const job = await this.solicitarImpresion(body);
    const comandos = (job.payload as { comandos: ComandoFiscal[] }).comandos;
    const resultado = await this.adapter.imprimirDocumento(comandos);
    return this.procesarResultado(job.id, resultado);
  }

  /**
   * El agente local reclama trabajos pendientes elegibles (`FOR UPDATE SKIP LOCKED` para que dos
   * agentes/cajas no tomen el mismo). Los marca RECLAMADO y devuelve sus comandos.
   */
  async reclamar(body: unknown): Promise<TrabajoReclamado[]> {
    const b = asRecord(body);
    const agenteId = requireString(b.agenteId, 'agenteId', 120);
    const limite = optionalInt(b.limite, 'limite', 10, 1);
    return withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      const jobs = await tx
        .select()
        .from(fiscalPrintQueue)
        .where(and(eq(fiscalPrintQueue.estado, 'PENDIENTE'), lte(fiscalPrintQueue.proximoIntento, ahora)))
        .orderBy(asc(fiscalPrintQueue.proximoIntento))
        .limit(limite)
        .for('update', { skipLocked: true });
      const reclamados: TrabajoReclamado[] = [];
      for (const j of jobs) {
        await tx
          .update(fiscalPrintQueue)
          .set({ estado: 'RECLAMADO', agenteId, reclamadoAt: ahora, updatedAt: ahora })
          .where(eq(fiscalPrintQueue.id, j.id));
        reclamados.push({ id: j.id, comandos: (j.payload as { comandos: ComandoFiscal[] }).comandos });
      }
      return reclamados;
    });
  }

  /** El agente reporta el desenlace de un trabajo que reclamó (IMPRESO | REINTENTABLE | PERMANENTE). */
  async reportarResultado(body: unknown): Promise<FilaPrintJob> {
    const b = asRecord(body);
    const jobId = requireUuid(b.jobId, 'jobId');
    const r = asRecord(b.resultado);
    const tipo = requireEnum(r.tipo, 'resultado.tipo', ['IMPRESO', 'REINTENTABLE', 'PERMANENTE'] as const, (s) => s.toUpperCase());
    const resultado: ResultadoImpresion =
      tipo === 'IMPRESO'
        ? {
            tipo,
            numeroFiscal: requireString(r.numeroFiscal, 'resultado.numeroFiscal', 40),
            controlFiscal: requireString(r.controlFiscal, 'resultado.controlFiscal', 40),
            acuse: r.acuse ?? {},
          }
        : { tipo, motivo: requireString(r.motivo, 'resultado.motivo', 500) };
    const { job } = await this.procesarResultado(jobId, resultado);
    return job;
  }

  /** Reporte X (corte parcial). Pasa por el adapter y se audita. */
  async reporteX(body: unknown): Promise<unknown> {
    return this.reporteFiscal(body, 'impresion.reporte_x', () => this.adapter.reporteX());
  }

  /** Reporte Z (cierre diario). Pasa por el adapter y se audita. */
  async reporteZ(body: unknown): Promise<unknown> {
    return this.reporteFiscal(body, 'impresion.reporte_z', () => this.adapter.reporteZ());
  }

  /** Lectura de la memoria fiscal (rango opcional). Pasa por el adapter y se audita. */
  async leerMemoriaFiscal(body: unknown): Promise<unknown> {
    const b = asRecord(body);
    const desdeFecha = optionalString(b.desdeFecha, 'desdeFecha', 10);
    const hastaFecha = optionalString(b.hastaFecha, 'hastaFecha', 10);
    const tieneDesdeZ = b.desdeZ !== undefined && b.desdeZ !== null && String(b.desdeZ).trim() !== '';
    const tieneHastaZ = b.hastaZ !== undefined && b.hastaZ !== null && String(b.hastaZ).trim() !== '';
    const rango: RangoMemoria = {
      ...(tieneDesdeZ ? { desdeZ: optionalInt(b.desdeZ, 'desdeZ', 0, 0) } : {}),
      ...(tieneHastaZ ? { hastaZ: optionalInt(b.hastaZ, 'hastaZ', 0, 0) } : {}),
      ...(desdeFecha !== null ? { desdeFecha } : {}),
      ...(hastaFecha !== null ? { hastaFecha } : {}),
    };
    return this.reporteFiscal(body, 'impresion.memoria_fiscal', () => this.adapter.leerMemoriaFiscal(rango));
  }

  /** Lista la cola de impresión (filtros opcionales `companyId`, `estado`). */
  async listar(query: Record<string, unknown>): Promise<FilaPrintJob[]> {
    const companyId = optionalUuid(query.companyId, 'companyId');
    const estado =
      query.estado === undefined || query.estado === null || String(query.estado).trim() === ''
        ? null
        : String(query.estado).toUpperCase();
    if (estado !== null && !['PENDIENTE', 'RECLAMADO', 'IMPRESO', 'ERROR'].includes(estado)) {
      throw new BadRequestException(`estado inválido: ${estado}`);
    }
    return withTenant(this.database.db, async (tx) => {
      if (companyId !== null) await asegurarEmpresaDelTenant(tx, companyId);
      const filtros = [
        ...(companyId !== null ? [eq(fiscalPrintQueue.companyId, companyId)] : []),
        ...(estado !== null ? [eq(fiscalPrintQueue.estado, estado)] : []),
      ];
      const where = filtros.length > 0 ? and(...filtros) : undefined;
      return tx.select().from(fiscalPrintQueue).where(where).orderBy(desc(fiscalPrintQueue.createdAt));
    });
  }

  // ── Internos ──────────────────────────────────────────────────────────────────

  /**
   * Procesa el desenlace de un trabajo de impresión. IMPRESO → emite el documento con la numeración
   * del hardware (EmisionService) y cierra el trabajo. REINTENTABLE → backoff (o ERROR al agotar
   * reintentos) + evento FALLO. PERMANENTE → ERROR + evento FALLO. La emisión y el cierre del trabajo
   * son transacciones separadas: el trabajo se marca IMPRESO SOLO si la emisión tuvo éxito.
   */
  private async procesarResultado(jobId: string, resultado: ResultadoImpresion): Promise<ResultadoImpresionDirecta> {
    const job = await this.cargarJob(jobId);
    if (job.estado === 'IMPRESO') {
      throw new BadRequestException('El trabajo ya fue impreso (idempotencia)');
    }

    if (resultado.tipo === 'IMPRESO') {
      const number = Number.parseInt(resultado.numeroFiscal, 10);
      if (!Number.isFinite(number) || number < 1) {
        throw new BadRequestException(`numeroFiscal inválido: ${resultado.numeroFiscal}`);
      }
      const emision = (job.payload as { emision: unknown }).emision;
      const documento = await this.emision.emitir(emision, {
        numeracionExterna: { number, numeroFiscal: resultado.numeroFiscal, controlFiscal: resultado.controlFiscal },
      });
      const actualizado = await withTenant(this.database.db, async (tx) => {
        const ahora = new Date();
        const [fila] = await tx
          .update(fiscalPrintQueue)
          .set({
            estado: 'IMPRESO',
            documentId: documento.documento.id,
            numeroFiscal: resultado.numeroFiscal,
            controlFiscal: resultado.controlFiscal,
            acuse: resultado.acuse as object,
            ultimoError: null,
            impresoAt: ahora,
            updatedAt: ahora,
          })
          .where(eq(fiscalPrintQueue.id, jobId))
          .returning();
        return fila;
      });
      if (actualizado === undefined) throw new Error('No se pudo cerrar el trabajo de impresión');
      return { job: actualizado, documento };
    }

    // Contingencia: la impresora no imprimió. Se registra FALLO y se decide reintento o error.
    const actualizado = await withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      await this.fiscalEventLog.registrar(tx, {
        companyId: job.companyId,
        documentId: null,
        eventType: 'FALLO',
        payload: { etapa: 'IMPRESION', tipo: resultado.tipo, motivo: resultado.motivo, jobId },
      });
      const esPermanente = resultado.tipo === 'PERMANENTE';
      const reintentos = job.reintentos + 1;
      const agotado = reintentos >= job.maxReintentos;
      const set =
        esPermanente || agotado
          ? {
              estado: 'ERROR' as const,
              reintentos: esPermanente ? job.reintentos : job.maxReintentos,
              ultimoError: resultado.motivo,
              updatedAt: ahora,
            }
          : {
              estado: 'PENDIENTE' as const,
              reintentos,
              ultimoError: resultado.motivo,
              proximoIntento: calcularProximoIntento(reintentos, ahora),
              updatedAt: ahora,
            };
      const [fila] = await tx.update(fiscalPrintQueue).set(set).where(eq(fiscalPrintQueue.id, jobId)).returning();
      return fila;
    });
    if (actualizado === undefined) throw new Error('No se pudo actualizar el trabajo de impresión');
    return { job: actualizado, documento: null };
  }

  private async reporteFiscal(
    body: unknown,
    accion: string,
    ejecutar: () => Promise<{ tipo: string; reporte?: unknown; motivo?: string }>,
  ): Promise<unknown> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const resultado = await ejecutar();
    if (resultado.tipo !== 'OK') {
      throw new BadRequestException(`La máquina fiscal no completó el reporte: ${resultado.motivo ?? resultado.tipo}`);
    }
    await withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      await this.audit.registrar(tx, { accion, entidad: 'fiscal_print_queue', after: resultado.reporte });
    });
    return resultado.reporte;
  }

  private async cargarJob(jobId: string): Promise<FilaPrintJob> {
    return withTenant(this.database.db, async (tx) => {
      const [fila] = await tx.select().from(fiscalPrintQueue).where(eq(fiscalPrintQueue.id, jobId)).limit(1);
      if (fila === undefined) throw new NotFoundException(`Trabajo de impresión ${jobId} no encontrado en el tenant actual`);
      return fila;
    });
  }

  /** Resuelve el adquirente para el documento fiscal: consumidor final, RIF del body o tercero maestro. */
  private async resolverAdquirente(tx: DatabaseTx, e: EntradaEmision): Promise<AdquirenteImpresion> {
    if (e.partyId !== null) {
      const [party] = await tx
        .select({ rif: parties.rif, razonSocial: parties.razonSocial })
        .from(parties)
        .where(and(eq(parties.id, e.partyId), eq(parties.companyId, e.companyId)))
        .limit(1);
      if (party === undefined) throw new NotFoundException(`Tercero ${e.partyId} no encontrado en la empresa`);
      return { tipo: 'IDENTIFICADO', rif: party.rif, nombre: party.razonSocial };
    }
    if (e.adquirenteRif !== null) {
      return { tipo: 'IDENTIFICADO', rif: e.adquirenteRif, nombre: e.adquirenteNombre ?? '' };
    }
    return { tipo: 'CONSUMIDOR_FINAL' };
  }
}

// ── Helpers puros ─────────────────────────────────────────────────────────────────

/** Mapea una línea de emisión (Bs) a la línea de impresión fiscal. */
function aLineaImpresion(l: EntradaEmision['lineas'][number]): LineaImpresion {
  return {
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitarioOrigen,
    descuento: l.descuentoOrigen ?? null,
    alicuotaCodigo: l.alicuotaCodigo,
    alicuotaTasa: l.alicuotaTasa,
  };
}

/** Medios de pago para el cierre fiscal: del body, o un único EFECTIVO por el total si no se indican. */
function parseMediosPago(body: unknown, totalVes: string): MedioPagoImpresion[] {
  const raw = asRecord(body).mediosPago;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ tipo: 'EFECTIVO', monto: totalVes }];
  }
  return raw.map((p, i) => {
    const o = asRecord(p);
    return {
      tipo: requireString(o.tipo, `mediosPago[${i}].tipo`, 40),
      descripcion: optionalString(o.descripcion, `mediosPago[${i}].descripcion`, 120),
      monto: requireString(o.monto, `mediosPago[${i}].monto`, 40),
    };
  });
}

/** Reconstruye el cuerpo de `EmisionService.emitir` desde la entrada parseada (para encolar en JSON). */
function emisionBodyDesde(e: EntradaEmision): Record<string, unknown> {
  return {
    companyId: e.companyId,
    seriesId: e.seriesId,
    tipo: e.tipo,
    branchId: e.branchId,
    moneda: e.moneda,
    rateBcv: e.rateBcv,
    rateUsdMgmt: e.rateUsdMgmt,
    exchangeRateId: e.exchangeRateId,
    medioEmision: 'MAQUINA_FISCAL',
    numeroControl: e.numeroControl,
    paymentCondition: e.paymentCondition,
    issueDate: e.issueDate.toISOString(),
    partyId: e.partyId,
    adquirenteRif: e.adquirenteRif,
    adquirenteNombre: e.adquirenteNombre,
    affectedDocumentId: e.affectedDocumentId,
    lineas: e.lineas.map((l) => ({
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
