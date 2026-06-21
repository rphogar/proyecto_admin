import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  construirControlVerificable,
  construirDocumentoDigital,
  type DocumentoDigital,
  type ImprentaDigital,
  type LineaDigital,
  type ImpuestoDigital,
  type SolicitudControlDigital,
  type TipoDocumentoDigital,
} from '@contave/imprenta-digital';
import { and, asc, desc, eq, lte, or } from 'drizzle-orm';
import { FiscalEventLogService } from '../cumplimiento/fiscal-event-log.service';
import { proximoIntento as calcularProximoIntento } from '../cumplimiento/backoff';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, digitalInvoiceDeliveries, documentLines, documentTaxes, parties, series } from '../db/schema';
import { type DocumentoEmitido, EmisionService, type EntradaEmision, parseEmision } from '../documentos/emision.service';
import { DocumentosService } from '../documentos/documentos.service';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, optionalUuid, requireEnum } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { IMPRENTA_DIGITAL } from './imprenta-digital.adapter';

export type FilaEntregaDigital = typeof digitalInvoiceDeliveries.$inferSelect;

/**
 * Base de la URL pública de verificación del control digital. TODO-TRIBUTARISTA: el dominio oficial de
 * consulta lo define el SENIAT/la imprenta autorizada; parametrizable por entorno hasta entonces.
 */
const BASE_URL_VERIFICACION = process.env.URL_VERIFICACION_DIGITAL ?? 'https://verificar.contave.app';

/** Retención legal del documento conservado: 10 años por COT (la 00102 exige mínimo 5). */
const RETENCION_ANIOS = 10;

/** Tipos de documento que admiten emisión digital (00102: factura y sus notas). */
const TIPOS_DIGITALES: ReadonlySet<string> = new Set<TipoDocumentoDigital>(['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO']);

/** Resultado de emitir una factura digital: documento emitido + estado de su entrega/conservación. */
export interface ResultadoEmisionDigital {
  documento: DocumentoEmitido;
  entrega: FilaEntregaDigital;
  /** Documento digital armado (requisitos 00071 + control verificable) para previsualización/entrega. */
  documentoDigital: DocumentoDigital;
}

export interface ResumenProcesoDigital {
  procesados: number;
  entregados: number;
  conservados: number;
  reintentables: number;
  errores: number;
}

/**
 * Régimen de **factura digital** (P24, Providencia SNAT/2024/000102; docs/02 §6.2, docs/05 §5,
 * docs/13). Orquesta el ciclo **emisión → asignación del número de control digital → entrega
 * electrónica → conservación** a través del adapter `ImprentaDigital` (punto de extensión único,
 * inyectado por token; hoy simulado).
 *
 * A diferencia de la máquina fiscal (P23), la emisión digital **sí consume el correlativo de la serie**
 * (numeración por software, consecutiva sin huecos): la imprenta digital autorizada solo asigna el
 * **número de control digital**. Tras emitir (documento inmutable, vía {@link EmisionService}), la
 * entrega y la conservación se gestionan en una **cola con reintentos y backoff** (`digital_invoice_
 * deliveries`), de modo que un proveedor caído no afecte la emisión ya consumada (contingencia).
 *
 * TODO-TRIBUTARISTA: la **obligatoriedad** del régimen digital (ventas por medios electrónicos:
 * e-commerce, redes sociales, plataformas) y su escalonamiento por tipo de contribuyente dependen de
 * la providencia; aquí la emisión digital es **opt-in** por endpoint, no se fuerza automáticamente.
 */
@Injectable()
export class FacturacionDigitalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly emision: EmisionService,
    private readonly documentos: DocumentosService,
    private readonly fiscalEventLog: FiscalEventLogService,
    @Inject(IMPRENTA_DIGITAL) private readonly adapter: ImprentaDigital,
  ) {}

  /**
   * Emite una factura digital: valida (00071/00102 salvo el número de control, que asigna la imprenta),
   * **solicita el número de control digital** al adapter, emite el documento (consume serie, inmutable),
   * arma el documento digital con su control verificable y **encola + intenta** la entrega electrónica y
   * la conservación. El documento queda emitido aunque la entrega quede pendiente de reintento.
   */
  async emitirDigital(body: unknown): Promise<ResultadoEmisionDigital> {
    const bodyDigital = { ...asRecord(body), medioEmision: 'IMPRENTA_DIGITAL' };
    const e = parseEmision(bodyDigital);
    if (!TIPOS_DIGITALES.has(e.tipo)) {
      throw new BadRequestException(`La factura digital admite FACTURA, NOTA_CREDITO y NOTA_DEBITO; no ${e.tipo}`);
    }

    // Pre-validación (todo MENOS el número de control, que aún no existe: lo asigna la imprenta). Así un
    // documento inválido no consume un número de control digital del proveedor.
    const { calculo, incumplimientos } = await this.documentos.calcular(bodyDigital);
    const faltas = incumplimientos.filter((i) => i.codigo !== 'SIN_NUMERO_CONTROL');
    if (faltas.length > 0) {
      throw new BadRequestException({ message: 'El documento no cumple los requisitos de emisión (00071/00102)', incumplimientos: faltas });
    }

    // Referencias para la solicitud de control y el documento digital (emisor, serie, adquirente).
    const refs = await this.cargarReferencias(e);
    const destinatario = parseDestinatario(body, refs.partyEmail);

    // 1) Solicitar y asignar el número de control digital a la imprenta autorizada.
    const solicitud: SolicitudControlDigital = {
      rifEmisor: refs.emisorRif,
      tipoDocumento: e.tipo as TipoDocumentoDigital,
      serie: refs.seriePrefijo,
      fechaEmision: e.issueDate.toISOString(),
      rifAdquirente: refs.adquirenteRif,
      totalVes: calculo.totales.totalVes,
      hashContenido: hashContenido(e, calculo.totales.totalVes, refs.adquirenteRif),
    };
    const control = await this.adapter.asignarControl(solicitud);
    if (control.tipo === 'REINTENTABLE') {
      throw new ServiceUnavailableException(`Imprenta digital no disponible para asignar el control: ${control.motivo}`);
    }
    if (control.tipo === 'PERMANENTE') {
      throw new BadRequestException(`La imprenta digital rechazó la asignación de control: ${control.motivo}`);
    }

    // 2) Emitir el documento (consume serie, inmutable) con el número de control digital asignado.
    const emitido = await this.emision.emitir({ ...bodyDigital, numeroControl: control.numeroControl });
    const doc = emitido.documento;

    // 3) Armar el documento digital (requisitos 00071 + control verificable: identificador/QR).
    const verificable = construirControlVerificable({
      rifEmisor: refs.emisorRif,
      numeroControl: control.numeroControl,
      tipoDocumento: e.tipo,
      serie: refs.seriePrefijo,
      numero: doc.number ?? 0,
      fechaFiscal: doc.issueFechaFiscal,
      rifAdquirente: doc.partyRif,
      totalVes: doc.totalVes ?? calculo.totales.totalVes,
      hashIntegridad: doc.hashIntegridad ?? '',
      baseUrlVerificacion: BASE_URL_VERIFICACION,
    });
    const documentoDigital = construirDocumentoDigital({
      tipoDocumento: e.tipo as TipoDocumentoDigital,
      emisor: { rif: refs.emisorRif, razonSocial: refs.emisorRazonSocial, domicilioFiscal: refs.emisorDomicilio },
      serie: refs.seriePrefijo,
      numero: doc.number ?? 0,
      numeroControl: control.numeroControl,
      adquirente: { esConsumidorFinal: doc.partyRif === null, rif: doc.partyRif, nombre: doc.partyNombre },
      fechaEmision: doc.issueDate.toISOString(),
      fechaFiscal: doc.issueFechaFiscal,
      moneda: doc.currency,
      rateBcv: doc.rateBcv,
      totalOrigen: doc.totalOrigen ?? calculo.totales.totalOrigen,
      totalVes: doc.totalVes ?? calculo.totales.totalVes,
      condicionPago: (doc.paymentCondition as 'CONTADO' | 'CREDITO') ?? 'CONTADO',
      lineas: emitido.lineas.map(aLineaDigital),
      impuestos: emitido.impuestos.map(aImpuestoDigital),
      hashIntegridad: doc.hashIntegridad ?? '',
      control: verificable,
    });

    // 4) Encolar la entrega/conservación e intentar de inmediato (contingencia → reintento con backoff).
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const [fila] = await tx
        .insert(digitalInvoiceDeliveries)
        .values({
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          documentId: doc.id,
          numeroControl: control.numeroControl,
          identificador: verificable.identificador,
          canal: destinatario.canal,
          destino: destinatario.direccion,
          payload: { documento: documentoDigital, destinatario } as object,
          estado: 'PENDIENTE',
          conservacionEstado: 'PENDIENTE',
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo encolar la entrega digital');
      const entrega = await this.procesarEntrega(tx, fila);
      return { documento: emitido, entrega, documentoDigital };
    });
  }

  /**
   * Reprocesa las entregas/conservaciones pendientes del tenant (PENDIENTE con `proximo_intento`
   * vencido). `FOR UPDATE SKIP LOCKED` evita doble procesamiento. Contingencia digital simétrica a la
   * remisión: reintenta con backoff y marca ERROR al agotar los reintentos.
   */
  async procesarPendientes(limiteRaw?: unknown): Promise<ResumenProcesoDigital> {
    const limite = clampLimite(limiteRaw);
    return withTenant(this.database.db, async (tx) => {
      const ahora = new Date();
      const pendientes = await tx
        .select()
        .from(digitalInvoiceDeliveries)
        .where(
          and(
            or(eq(digitalInvoiceDeliveries.estado, 'PENDIENTE'), eq(digitalInvoiceDeliveries.conservacionEstado, 'PENDIENTE')),
            lte(digitalInvoiceDeliveries.proximoIntento, ahora),
          ),
        )
        .orderBy(asc(digitalInvoiceDeliveries.proximoIntento))
        .limit(limite)
        .for('update', { skipLocked: true });

      const resumen: ResumenProcesoDigital = { procesados: 0, entregados: 0, conservados: 0, reintentables: 0, errores: 0 };
      for (const item of pendientes) {
        resumen.procesados += 1;
        const previo = item;
        const actualizado = await this.procesarEntrega(tx, item);
        if (actualizado.estado === 'ENTREGADO' && previo.estado !== 'ENTREGADO') resumen.entregados += 1;
        if (actualizado.conservacionEstado === 'CONSERVADO' && previo.conservacionEstado !== 'CONSERVADO') resumen.conservados += 1;
        if (actualizado.estado === 'ERROR' || actualizado.conservacionEstado === 'ERROR') resumen.errores += 1;
        else if (actualizado.estado === 'PENDIENTE' || actualizado.conservacionEstado === 'PENDIENTE') resumen.reintentables += 1;
      }
      return resumen;
    });
  }

  /** Lista la cola de entregas digitales (filtros opcionales `companyId`, `estado`). */
  async listar(query: Record<string, unknown>): Promise<FilaEntregaDigital[]> {
    const companyId = optionalUuid(query.companyId, 'companyId');
    const estado =
      query.estado === undefined || query.estado === null || String(query.estado).trim() === '' ? null : String(query.estado).toUpperCase();
    if (estado !== null && !['PENDIENTE', 'ENTREGADO', 'ERROR'].includes(estado)) {
      throw new BadRequestException(`estado inválido: ${estado}`);
    }
    return withTenant(this.database.db, async (tx) => {
      if (companyId !== null) await asegurarEmpresaDelTenant(tx, companyId);
      const filtros = [
        ...(companyId !== null ? [eq(digitalInvoiceDeliveries.companyId, companyId)] : []),
        ...(estado !== null ? [eq(digitalInvoiceDeliveries.estado, estado)] : []),
      ];
      const where = filtros.length > 0 ? and(...filtros) : undefined;
      return tx.select().from(digitalInvoiceDeliveries).where(where).orderBy(desc(digitalInvoiceDeliveries.createdAt));
    });
  }

  // ── Internos ──────────────────────────────────────────────────────────────────

  /**
   * Intenta la entrega electrónica y la conservación de un ítem (los estados son independientes). Cada
   * éxito registra su evento en la bitácora fiscal (ENTREGA / CONSERVACION). Si algo es REINTENTABLE,
   * avanza el backoff; si se agotan los reintentos, lo pendiente queda en ERROR. Todo dentro de `tx`.
   */
  private async procesarEntrega(tx: DatabaseTx, fila: FilaEntregaDigital): Promise<FilaEntregaDigital> {
    const ahora = new Date();
    const payload = fila.payload as { documento: DocumentoDigital; destinatario: { canal: 'EMAIL' | 'OTRO'; direccion: string } };
    let estado = fila.estado;
    let conservacionEstado = fila.conservacionEstado;
    let entregaAcuse = fila.entregaAcuse;
    let entregadoAt = fila.entregadoAt;
    let conservacionRef = fila.conservacionRef;
    let conservadoAt = fila.conservadoAt;
    let ultimoError: string | null = null;
    let huboReintentable = false;

    if (estado === 'PENDIENTE') {
      const r = await this.adapter.entregar({ documento: payload.documento, destinatario: payload.destinatario });
      if (r.tipo === 'ENTREGADO') {
        estado = 'ENTREGADO';
        entregaAcuse = r.acuse as object;
        entregadoAt = new Date(r.entregadoEn);
        await this.fiscalEventLog.registrar(tx, {
          companyId: fila.companyId,
          documentId: fila.documentId,
          eventType: 'ENTREGA',
          documentNumber: fila.numeroControl,
          controlNumber: fila.numeroControl,
          payload: { canal: payload.destinatario.canal, destino: payload.destinatario.direccion, identificador: fila.identificador, acuse: r.acuse },
        });
      } else if (r.tipo === 'PERMANENTE') {
        estado = 'ERROR';
        ultimoError = r.motivo;
      } else {
        huboReintentable = true;
        ultimoError = r.motivo;
      }
    }

    if (conservacionEstado === 'PENDIENTE') {
      const r = await this.adapter.conservar({ documento: payload.documento, retencionAnios: RETENCION_ANIOS });
      if (r.tipo === 'CONSERVADO') {
        conservacionEstado = 'CONSERVADO';
        conservacionRef = r.referencia;
        conservadoAt = ahora;
        await this.fiscalEventLog.registrar(tx, {
          companyId: fila.companyId,
          documentId: fila.documentId,
          eventType: 'CONSERVACION',
          documentNumber: fila.numeroControl,
          controlNumber: fila.numeroControl,
          payload: { referencia: r.referencia, retencionAnios: RETENCION_ANIOS, acuse: r.acuse },
        });
      } else if (r.tipo === 'PERMANENTE') {
        conservacionEstado = 'ERROR';
        ultimoError = ultimoError ?? r.motivo;
      } else {
        huboReintentable = true;
        ultimoError = ultimoError ?? r.motivo;
      }
    }

    let reintentos = fila.reintentos;
    let proximoIntento = fila.proximoIntento;
    if (huboReintentable) {
      reintentos = fila.reintentos + 1;
      if (reintentos >= fila.maxReintentos) {
        // Agotados los reintentos: lo que siga pendiente se marca como ERROR (contingencia persistente).
        if (estado === 'PENDIENTE') estado = 'ERROR';
        if (conservacionEstado === 'PENDIENTE') conservacionEstado = 'ERROR';
        reintentos = fila.maxReintentos;
      } else {
        proximoIntento = calcularProximoIntento(reintentos, ahora);
      }
    }

    const [actualizado] = await tx
      .update(digitalInvoiceDeliveries)
      .set({ estado, conservacionEstado, entregaAcuse, entregadoAt, conservacionRef, conservadoAt, reintentos, proximoIntento, ultimoError, updatedAt: ahora })
      .where(eq(digitalInvoiceDeliveries.id, fila.id))
      .returning();
    if (actualizado === undefined) throw new Error('No se pudo actualizar la entrega digital');
    return actualizado;
  }

  /** Carga emisor (empresa), prefijo de serie y datos del adquirente para armar el documento digital. */
  private async cargarReferencias(e: EntradaEmision): Promise<Referencias> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new NotFoundException(`Empresa ${e.companyId} no encontrada`);
      const [serie] = await tx.select().from(series).where(eq(series.id, e.seriesId)).limit(1);
      if (serie === undefined) throw new NotFoundException(`Serie ${e.seriesId} no encontrada`);
      let adquirenteRif = e.adquirenteRif;
      let partyEmail: string | null = null;
      if (e.partyId !== null) {
        const [party] = await tx
          .select({ rif: parties.rif, email: parties.email })
          .from(parties)
          .where(and(eq(parties.id, e.partyId), eq(parties.companyId, e.companyId)))
          .limit(1);
        if (party === undefined) throw new NotFoundException(`Tercero ${e.partyId} no encontrado en la empresa`);
        adquirenteRif = party.rif;
        partyEmail = party.email;
      }
      return {
        emisorRif: company.rif,
        emisorRazonSocial: company.razonSocial,
        emisorDomicilio: company.direccionFiscal ?? '',
        seriePrefijo: serie.prefijo,
        adquirenteRif,
        partyEmail,
      };
    });
  }
}

interface Referencias {
  emisorRif: string;
  emisorRazonSocial: string;
  emisorDomicilio: string;
  seriePrefijo: string;
  adquirenteRif: string | null;
  partyEmail: string | null;
}

// ── Helpers puros ─────────────────────────────────────────────────────────────────

/** Mapea una línea del documento emitido (DB) a la línea del documento digital. */
function aLineaDigital(l: typeof documentLines.$inferSelect): LineaDigital {
  return {
    lineaNo: l.lineaNo,
    descripcion: l.descripcion,
    cantidad: l.cantidad,
    precioUnitario: l.precioUnitarioOrigen,
    descuento: l.descuentoOrigen,
    alicuotaCodigo: l.alicuotaCodigo,
    alicuotaTasa: l.alicuotaTasa,
    baseOrigen: l.baseOrigen,
    ivaOrigen: l.ivaOrigen,
  };
}

/** Mapea un impuesto del documento emitido (DB) al impuesto del documento digital. */
function aImpuestoDigital(t: typeof documentTaxes.$inferSelect): ImpuestoDigital {
  return { alicuotaCodigo: t.alicuotaCodigo, alicuotaTasa: t.alicuotaTasa, base: t.baseOrigen, monto: t.montoOrigen };
}

/** Hash del contenido del documento (integridad pre-emisión; aún sin número de control). */
function hashContenido(e: EntradaEmision, totalVes: string, adquirenteRif: string | null): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        companyId: e.companyId,
        tipo: e.tipo,
        moneda: e.moneda,
        totalVes,
        adquirenteRif,
        fechaEmision: e.issueDate.toISOString(),
        lineas: e.lineas.map((l) => ({ d: l.descripcion, c: l.cantidad, p: l.precioUnitarioOrigen, a: l.alicuotaCodigo, t: l.alicuotaTasa })),
      }),
    )
    .digest('hex');
}

/** Canal y dirección de entrega: del body (`entrega.canal`/`entrega.direccion`) o el email del tercero. */
function parseDestinatario(body: unknown, partyEmail: string | null): { canal: 'EMAIL' | 'OTRO'; direccion: string } {
  const ent = asRecord(asRecord(body).entrega ?? {});
  const canal =
    ent.canal === undefined || ent.canal === null || String(ent.canal).trim() === ''
      ? 'EMAIL'
      : requireEnum(ent.canal, 'entrega.canal', ['EMAIL', 'OTRO'] as const, (s) => s.toUpperCase());
  const explicita = optionalString(ent.direccion, 'entrega.direccion', 320);
  const direccion = explicita ?? (canal === 'EMAIL' ? partyEmail : null);
  if (direccion === null || direccion.trim() === '') {
    throw new BadRequestException('La factura digital requiere una dirección de entrega (entrega.direccion o email del tercero)');
  }
  return { canal, direccion };
}

/** Limita el tamaño del lote a procesar [1, 200], default 50. */
function clampLimite(raw: unknown): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 50;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 200);
}
