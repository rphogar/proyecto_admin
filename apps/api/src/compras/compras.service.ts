import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  evaluarFacturaCompra,
  formatearNumeroComprobante,
  generarTxtRetencionIva,
  type LineaRetencionIvaTxt,
  type TipoDocumentoTxt,
  type TipoPersonaIslr,
} from '@contave/fiscal-engine';
import { Asiento, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, eq, max, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import {
  accounts,
  companies,
  parties,
  periods,
  purchaseLines,
  purchaseTaxes,
  purchases,
  retentionsIssued,
} from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalDecimal,
  optionalString,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import {
  armarAsientoCompra,
  calcularCompra,
  type BorradorCompra,
  type CompraCalculada,
  type RetencionIslrParams,
} from './calculo-compra';
import { parseLineas } from './dto';
import { resolverRetencionIslrTabla } from './resolver-islr';

const TIPOS_DOC_PROVEEDOR = ['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO'] as const;
/** Tipo de operación de una compra (exportación no aplica a compras). */
const TIPOS_OPERACION_COMPRA = ['INTERNA', 'IMPORTACION'] as const;
/** Mapa tipo de documento del proveedor → código de tipo en el TXT del portal. */
const TIPO_DOC_TXT: Record<(typeof TIPOS_DOC_PROVEEDOR)[number], TipoDocumentoTxt> = {
  FACTURA: '01',
  NOTA_DEBITO: '02',
  NOTA_CREDITO: '03',
};

export interface EntradaCompra {
  companyId: string;
  branchId: string | null;
  partyId: string;
  tipoDocumento: (typeof TIPOS_DOC_PROVEEDOR)[number];
  numeroDocumento: string;
  numeroControl: string;
  numeroDocumentoAfectado: string | null;
  /** Tipo de operación del Libro de Compras: INTERNA | IMPORTACION (Reglamento IVA arts. 70–78). */
  tipoOperacion: (typeof TIPOS_OPERACION_COMPRA)[number];
  cuentaDestino: string;
  fechaDocumento: Date;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  exchangeRateId: string | null;
  lineas: BorradorCompra['lineas'];
  /** Forzar 100% por incumplimientos de la factura (Prov. 0049): no discrimina IVA, sin control. */
  forzarRetencion100: boolean;
  /** La factura discrimina el IVA por alícuota (requisito 00071; caso 29). Default true. */
  discriminaIva: boolean;
  /** RIF del proveedor inconsistente/no inscrito → fuerza 100% (Prov. 0049; caso 29). */
  rifInconsistente: boolean;
  /** Concepto ISLR (si aplica retención de ISLR): honorarios, servicios… (etiqueta libre). */
  conceptoIslr: string | null;
  /** Código de concepto de la tabla 1.808 (resuelve tarifa/sustraendo del parámetro; alternativa a tarifaIslr). */
  conceptoIslrCodigo: string | null;
  /** Tipo de persona del retenido para la tabla 1.808 (PN_RESIDENTE | PJ_DOMICILIADA). */
  tipoPersonaIslr: TipoPersonaIslr | null;
  /** Tarifa ISLR en % (si se pasa, tiene prioridad sobre la tabla 1.808). */
  tarifaIslr: string | null;
  /** Sustraendo ISLR en moneda origen (PN residente); null = 0. */
  sustraendoIslr: string | null;
  /** Base gravada por el concepto ISLR (caso 32); null = base imponible total o por línea. */
  baseIslr: string | null;
  /** Marca por línea de sujeción a ISLR (caso 32: porción de servicio). Alineada con `lineas`. */
  lineasSujetasIslr: boolean[];
}

function parseCompra(body: unknown): EntradaCompra {
  const b = asRecord(body);
  const moneda = requireString(b.moneda, 'moneda', 12).toUpperCase();
  const esVes = moneda === 'VES';

  const fechaRaw = b.fechaDocumento ?? b.fecha ?? b.issueDate;
  const fechaDocumento = fechaRaw == null || String(fechaRaw).trim() === '' ? new Date() : new Date(String(fechaRaw));
  if (Number.isNaN(fechaDocumento.getTime())) {
    throw new BadRequestException(`fechaDocumento inválida: ${String(fechaRaw)}`);
  }

  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    branchId: optionalUuid(b.branchId, 'branchId'),
    partyId: requireUuid(b.partyId, 'partyId'),
    tipoDocumento: requireEnumOpt(b.tipoDocumento, 'tipoDocumento', TIPOS_DOC_PROVEEDOR, 'FACTURA'),
    numeroDocumento: requireString(b.numeroDocumento, 'numeroDocumento', 40),
    numeroControl: requireString(b.numeroControl, 'numeroControl', 40),
    numeroDocumentoAfectado: optionalString(b.numeroDocumentoAfectado, 'numeroDocumentoAfectado', 40),
    tipoOperacion: requireEnumOpt(b.tipoOperacion, 'tipoOperacion', TIPOS_OPERACION_COMPRA, 'INTERNA'),
    cuentaDestino: optionalString(b.cuentaDestino, 'cuentaDestino', 20) ?? '5.2',
    fechaDocumento,
    moneda,
    rateBcv: esVes ? null : requireDecimal(b.rateBcv, 'rateBcv'),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    exchangeRateId: optionalUuid(b.exchangeRateId, 'exchangeRateId'),
    lineas: parseLineas(b.lineas),
    forzarRetencion100: b.forzarRetencion100 === true,
    discriminaIva: b.discriminaIva !== false && b.forzarRetencion100 !== true,
    rifInconsistente: b.rifInconsistente === true,
    conceptoIslr: optionalString(b.conceptoIslr, 'conceptoIslr', 60),
    conceptoIslrCodigo: optionalString(b.conceptoIslrCodigo, 'conceptoIslrCodigo', 20),
    tipoPersonaIslr: parseTipoPersona(b.tipoPersonaIslr),
    tarifaIslr: optionalDecimal(b.tarifaIslr, 'tarifaIslr'),
    sustraendoIslr: optionalDecimal(b.sustraendoIslr, 'sustraendoIslr'),
    baseIslr: optionalDecimal(b.baseIslr, 'baseIslr'),
    lineasSujetasIslr: (b.lineas as unknown[]).map((l) => asRecord(l).sujetoIslr === true),
  };
}

function requireEnumOpt<T extends string>(valor: unknown, campo: string, permitidos: readonly T[], def: T): T {
  if (valor === undefined || valor === null || String(valor).trim() === '') return def;
  return requireEnum(valor, campo, permitidos, (s) => s.toUpperCase());
}

const TIPOS_PERSONA_ISLR = ['PN_RESIDENTE', 'PJ_DOMICILIADA'] as const;

/** Parsea el tipo de persona para la tabla 1.808 (opcional). */
function parseTipoPersona(valor: unknown): TipoPersonaIslr | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  return requireEnum(valor, 'tipoPersonaIslr', TIPOS_PERSONA_ISLR, (s) => s.toUpperCase());
}

/** Compra registrada con su detalle y los comprobantes de retención emitidos. */
export interface CompraRegistrada {
  compra: typeof purchases.$inferSelect;
  lineas: (typeof purchaseLines.$inferSelect)[];
  impuestos: (typeof purchaseTaxes.$inferSelect)[];
  retenciones: (typeof retentionsIssued.$inferSelect)[];
  /** El crédito fiscal de IVA es deducible (factura cumple requisitos 00071; caso 29). */
  creditoFiscalDeducible: boolean;
  /** Alertas no bloqueantes (caso 29: 100%/no deducible; caso 32: ISLR sobre el total sin discriminar). */
  alertas: string[];
}

/**
 * Registro de facturas de compra con retenciones (P9, docs/02 §3.3/§4, docs/06 M2). Transacción
 * única: cálculo (triple base + retenciones IVA/ISLR) → asiento POSTED → compra REGISTERED + líneas +
 * impuestos → comprobantes de retención emitidos (numeración AAAAMMNNNNNNNN, consecutiva por
 * período/tipo) + TXT SENIAT → auditoría. Todo bajo RLS. La compra y los comprobantes son inmutables.
 */
@Injectable()
export class ComprasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async registrar(body: unknown): Promise<CompraRegistrada> {
    const e = parseCompra(body);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new NotFoundException(`Empresa ${e.companyId} no encontrada`);
      const proveedor = await cargarProveedor(tx, e.partyId, e.companyId);
      const cuentas = await cargarCuentas(tx, e.companyId);
      if (!cuentas.has(e.cuentaDestino)) {
        throw new BadRequestException(`La cuenta de destino "${e.cuentaDestino}" no existe en el plan de la empresa`);
      }

      // ── Resolución de las retenciones a aplicar (la empresa debe ser agente = SPE) ──
      const esAgente = company.spe;
      const aplicaRetIva = esAgente && tieneIva(e.lineas);
      // Evaluación 00071/0049 (caso 29): % de retención + deducibilidad del crédito fiscal + alertas.
      const evaluacion = evaluarFacturaCompra({
        discriminaIva: e.discriminaIva,
        numeroControl: e.numeroControl,
        rifInconsistente: e.rifInconsistente,
        pctProveedor: proveedor.pctRetencionIva,
      });
      const pctIva = evaluacion.pctRetencionIva;
      const alertas = [...evaluacion.alertas];

      // Tarifa/sustraendo: explícitos (prioridad) o resueltos de la tabla 1.808 parametrizable (P22).
      let conceptoIslrLabel = e.conceptoIslr;
      let tarifaIslr = e.tarifaIslr;
      let sustraendoIslr = e.sustraendoIslr;
      if (esAgente && e.tarifaIslr === null && e.conceptoIslrCodigo !== null && e.tipoPersonaIslr !== null) {
        if (e.moneda !== 'VES') {
          throw new BadRequestException(
            'La resolución por tabla 1.808 deriva el sustraendo en Bs; para documentos en divisa pase tarifaIslr/sustraendoIslr explícitos',
          );
        }
        const resuelta = await resolverRetencionIslrTabla(tx, fechaFiscal(e.fechaDocumento), {
          conceptoCodigo: e.conceptoIslrCodigo,
          tipoPersona: e.tipoPersonaIslr,
        });
        conceptoIslrLabel = conceptoIslrLabel ?? resuelta.concepto;
        tarifaIslr = resuelta.tarifa;
        sustraendoIslr = resuelta.sustraendoVes;
      }

      const aplicaRetIslr = esAgente && conceptoIslrLabel !== null && tarifaIslr !== null;
      const retIslrParams: RetencionIslrParams | undefined = aplicaRetIslr
        ? {
            aplica: true,
            concepto: conceptoIslrLabel as string,
            tarifa: tarifaIslr as string,
            sustraendo: sustraendoIslr,
            // base explícita > marcas por línea (caso 32) > total del documento.
            ...(e.baseIslr !== null ? { base: e.baseIslr } : { lineasSujetas: e.lineasSujetasIslr }),
          }
        : undefined;

      const borrador: BorradorCompra = {
        moneda: e.moneda,
        rateBcv: e.rateBcv,
        rateUsdMgmt: e.rateUsdMgmt,
        cuentaDestino: e.cuentaDestino,
        lineas: e.lineas,
        retencionIva: { aplica: aplicaRetIva, porcentaje: pctIva },
        ...(retIslrParams ? { retencionIslr: retIslrParams } : {}),
      };
      const calc = calcularCompra(borrador);
      if (calc.retencionIslr.aplica && calc.retencionIslr.baseSinDiscriminar) {
        alertas.push('Retención de ISLR calculada sobre el TOTAL: la factura no discrimina servicio vs. materiales (caso 32, revisar con tributarista).');
      }

      // ── Período abierto + asiento POSTED ──
      const { anio, mes } = periodoFiscal(e.fechaDocumento);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);
      const purchaseId = randomUUID();
      const etiqueta = `Compra ${e.tipoDocumento} ${e.numeroDocumento} de ${proveedor.razonSocial}`;
      const entrada = armarAsientoCompra(calc, {
        fecha: e.fechaDocumento,
        descripcion: etiqueta,
        moneda: e.moneda,
        rateBcv: e.rateBcv,
        rateUsdMgmt: e.rateUsdMgmt,
        cuentaDestino: e.cuentaDestino,
        partyId: e.partyId,
        companyId: e.companyId,
        sourceId: purchaseId,
      });
      const asiento = postear(Asiento.construir(entrada));
      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas,
      });

      // ── Compra REGISTERED + líneas + impuestos ──
      const fFiscal = fechaFiscal(e.fechaDocumento);
      const totales = calc.documento.totales;
      const baseOrigen = calc.documento.impuestos.reduce((a, t) => a.plus(t.baseOrigen), new Decimal(0));
      const baseVes = calc.documento.impuestos.reduce((a, t) => a.plus(t.baseVes), new Decimal(0));
      const baseUsd = calc.documento.impuestos.reduce((a, t) => a.plus(t.baseUsdMgmt), new Decimal(0));
      const ivaOrigen = calc.documento.impuestos.reduce((a, t) => a.plus(t.montoOrigen), new Decimal(0));
      const ivaVes = calc.documento.impuestos.reduce((a, t) => a.plus(t.montoVes), new Decimal(0));
      const ivaUsd = calc.documento.impuestos.reduce((a, t) => a.plus(t.montoUsdMgmt), new Decimal(0));
      // Compras sin derecho a crédito (exento/exonerado) para la columna del TXT del portal.
      const exentoVes = calc.documento.impuestos
        .filter((t) => t.alicuotaCodigo === 'EXENTO' || t.alicuotaCodigo === 'EXONERADO')
        .reduce((a, t) => a.plus(t.baseVes), new Decimal(0));

      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            purchaseId,
            companyId: e.companyId,
            partyId: e.partyId,
            numeroDocumento: e.numeroDocumento,
            numeroControl: e.numeroControl,
            totalVes: totales.totalVes,
            entryId,
          }),
        )
        .digest('hex');

      const [compra] = await tx
        .insert(purchases)
        .values({
          id: purchaseId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          branchId: e.branchId,
          partyId: e.partyId,
          proveedorRif: proveedor.rif,
          proveedorNombre: proveedor.razonSocial,
          tipoDocumento: e.tipoDocumento,
          numeroDocumento: e.numeroDocumento,
          numeroControl: e.numeroControl,
          numeroDocumentoAfectado: e.numeroDocumentoAfectado,
          tipoOperacion: e.tipoOperacion,
          cuentaDestino: e.cuentaDestino,
          fechaDocumento: e.fechaDocumento,
          fechaFiscal: fFiscal,
          currency: e.moneda,
          exchangeRateId: e.exchangeRateId,
          rateBcv: e.rateBcv,
          rateUsdMgmt: e.rateUsdMgmt,
          journalEntryId: entryId,
          baseOrigen: baseOrigen.toFixed(8),
          baseVes: baseVes.toFixed(8),
          baseUsdMgmt: baseUsd.toFixed(8),
          ivaOrigen: ivaOrigen.toFixed(8),
          ivaVes: ivaVes.toFixed(8),
          ivaUsdMgmt: ivaUsd.toFixed(8),
          totalOrigen: totales.totalOrigen,
          totalVes: totales.totalVes,
          totalUsdMgmt: totales.totalUsdMgmt,
          retencionIvaVes: calc.retencionIva.aplica ? calc.retencionIva.monto.ves : null,
          retencionIslrVes: calc.retencionIslr.aplica ? calc.retencionIslr.monto.ves : null,
          hashIntegridad: hash,
          status: 'REGISTERED',
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (compra === undefined) throw new Error('No se pudo registrar la compra');

      const lineas = await tx
        .insert(purchaseLines)
        .values(
          calc.documento.lineas.map((l) => ({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            purchaseId,
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
        .insert(purchaseTaxes)
        .values(
          calc.documento.impuestos.map((t) => ({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            purchaseId,
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

      // ── Comprobantes de retención emitidos (mismo flujo, docs/06 M2) ──
      const retenciones: (typeof retentionsIssued.$inferSelect)[] = [];
      if (calc.retencionIva.aplica) {
        retenciones.push(
          await this.emitirComprobante(tx, {
            ctx,
            company,
            proveedor,
            purchaseId,
            tipo: 'IVA',
            anio,
            mes,
            fechaFiscal: fFiscal,
            moneda: e.moneda,
            rateBcv: e.rateBcv,
            baseOrigen: calc.retencionIva.base.origen,
            baseVes: calc.retencionIva.base.ves,
            porcentaje: calc.retencionIva.porcentaje,
            sustraendoVes: '0',
            montoOrigen: calc.retencionIva.monto.origen,
            montoVes: calc.retencionIva.monto.ves,
            conceptoIslr: null,
            // Datos de la línea TXT del portal (el número de comprobante se inyecta al emitir).
            txtLinea: {
              rifAgente: company.rif,
              rifRetenido: proveedor.rif,
              fechaDocumento: fFiscal,
              tipoDocumento: TIPO_DOC_TXT[e.tipoDocumento],
              numeroDocumento: e.numeroDocumento,
              numeroControl: e.numeroControl,
              numeroDocumentoAfectado: e.numeroDocumentoAfectado,
              totalCompraConIva: totales.totalVes,
              comprasSinCredito: exentoVes.toFixed(2),
              baseImponible: baseVes.toFixed(2),
              alicuota: alicuotaPrincipal(calc),
              impuestoIva: ivaVes.toFixed(2),
              ivaRetenido: calc.retencionIva.monto.ves,
              porcentajeRetencion: calc.retencionIva.porcentaje,
            },
          }),
        );
      }
      if (calc.retencionIslr.aplica) {
        retenciones.push(
          await this.emitirComprobante(tx, {
            ctx,
            company,
            proveedor,
            purchaseId,
            tipo: 'ISLR',
            anio,
            mes,
            fechaFiscal: fFiscal,
            moneda: e.moneda,
            rateBcv: e.rateBcv,
            baseOrigen: calc.retencionIslr.base.origen,
            baseVes: calc.retencionIslr.base.ves,
            porcentaje: calc.retencionIslr.porcentaje,
            sustraendoVes: calc.retencionIslr.sustraendo.ves,
            montoOrigen: calc.retencionIslr.monto.origen,
            montoVes: calc.retencionIslr.monto.ves,
            conceptoIslr: calc.retencionIslr.concepto,
            txtLinea: null,
          }),
        );
      }

      await this.audit.registrar(tx, { accion: 'compra.create', entidad: 'purchases', entidadId: purchaseId, after: compra });

      return { compra, lineas, impuestos, retenciones, creditoFiscalDeducible: evaluacion.creditoFiscalDeducible, alertas };
    });
  }

  /** Lista compras de la empresa. */
  async listar(companyId: string): Promise<(typeof purchases.$inferSelect)[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(purchases).where(eq(purchases.companyId, companyId));
    });
  }

  /** Emite un comprobante de retención (correlativo consecutivo por período/tipo, sin huecos). */
  private async emitirComprobante(tx: DatabaseTx, p: ComprobanteParams): Promise<typeof retentionsIssued.$inferSelect> {
    const correlativo = await siguienteCorrelativo(tx, p.company.id, p.tipo, p.anio, p.mes);
    const numero = formatearNumeroComprobante({ anio: p.anio, mes: p.mes }, correlativo);
    // El TXT del portal se genera con el número de comprobante ya asignado (sin parches de texto).
    const txt = p.txtLinea === null ? null : generarTxtRetencionIva([{ ...p.txtLinea, numeroComprobante: numero }]);
    const hash = createHash('sha256')
      .update(JSON.stringify({ companyId: p.company.id, tipo: p.tipo, numero, purchaseId: p.purchaseId, montoVes: p.montoVes }))
      .digest('hex');

    const [row] = await tx
      .insert(retentionsIssued)
      .values({
        tenantId: p.ctx.tenantId,
        companyId: p.company.id,
        purchaseId: p.purchaseId,
        partyId: p.proveedor.id,
        proveedorRif: p.proveedor.rif,
        proveedorNombre: p.proveedor.razonSocial,
        tipo: p.tipo,
        numeroComprobante: numero,
        correlativo,
        periodoAnio: p.anio,
        periodoMes: p.mes,
        conceptoIslr: p.conceptoIslr,
        currency: p.moneda,
        rateBcv: p.rateBcv,
        baseOrigen: p.baseOrigen,
        baseVes: p.baseVes,
        porcentaje: p.porcentaje,
        sustraendoVes: p.sustraendoVes,
        montoOrigen: p.montoOrigen,
        montoVes: p.montoVes,
        fechaFiscal: p.fechaFiscal,
        txtExport: txt,
        hashIntegridad: hash,
        createdBy: p.ctx.userId ?? null,
      })
      .returning();
    if (row === undefined) throw new Error('No se pudo emitir el comprobante de retención');
    return row;
  }
}

interface ComprobanteParams {
  ctx: { tenantId: string; userId?: string | undefined };
  company: typeof companies.$inferSelect;
  proveedor: typeof parties.$inferSelect;
  purchaseId: string;
  tipo: 'IVA' | 'ISLR';
  anio: number;
  mes: number;
  fechaFiscal: string;
  moneda: string;
  rateBcv: string | null;
  baseOrigen: string;
  baseVes: string;
  porcentaje: string;
  sustraendoVes: string;
  montoOrigen: string;
  montoVes: string;
  conceptoIslr: string | null;
  /** Datos de la línea del TXT del portal (solo IVA); el número de comprobante se inyecta al emitir. */
  txtLinea: Omit<LineaRetencionIvaTxt, 'numeroComprobante'> | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tieneIva(lineas: BorradorCompra['lineas']): boolean {
  return lineas.some((l) => new Decimal(l.alicuotaTasa).gt(0));
}

/** Alícuota principal (mayor base gravada) para la línea consolidada del TXT. */
function alicuotaPrincipal(calc: CompraCalculada): string {
  const gravadas = calc.documento.impuestos.filter((t) => new Decimal(t.montoVes).gt(0));
  if (gravadas.length === 0) return '0';
  const top = gravadas.reduce((a, b) => (new Decimal(b.baseVes).gt(a.baseVes) ? b : a));
  return new Decimal(top.alicuotaTasa).toFixed();
}

async function cargarProveedor(tx: DatabaseTx, partyId: string, companyId: string): Promise<typeof parties.$inferSelect> {
  const [row] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.companyId, companyId)))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Proveedor ${partyId} no encontrado en la empresa`);
  if (row.tipo === 'cliente') {
    throw new BadRequestException('El tercero no es proveedor (tipo "cliente")');
  }
  return row;
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

/**
 * Siguiente correlativo del comprobante por (empresa, tipo, período). Serializa con un advisory lock
 * de transacción para que, bajo concurrencia, la numeración salga consecutiva y sin huecos (regla 6,
 * patrón de contador transaccional, docs/05 §4). El lock se libera al COMMIT/ROLLBACK.
 */
async function siguienteCorrelativo(tx: DatabaseTx, companyId: string, tipo: string, anio: number, mes: number): Promise<number> {
  const clave = `retencion:${companyId}:${tipo}:${anio}-${mes}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`);
  const [row] = await tx
    .select({ m: max(retentionsIssued.correlativo) })
    .from(retentionsIssued)
    .where(
      and(
        eq(retentionsIssued.companyId, companyId),
        eq(retentionsIssued.tipo, tipo),
        eq(retentionsIssued.periodoAnio, anio),
        eq(retentionsIssued.periodoMes, mes),
      ),
    );
  return (row?.m ?? 0) + 1;
}
