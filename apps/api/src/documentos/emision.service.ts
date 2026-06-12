import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AlicuotaCodigo,
  type DocumentoAEmitir,
  type MedioEmision,
  type TipoDocumento,
  validarRequisitosFactura,
} from '@contave/fiscal-engine';
import { Asiento, postear } from '@contave/ledger';
import { fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import {
  accounts,
  branches,
  companies,
  documentLines,
  documentTaxes,
  documents,
  parties,
  periods,
  series,
} from '../db/schema';
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
  armarAsientoFacturaVenta,
  type BorradorCalculo,
  calcularDocumento,
  type DocumentoCalculado,
  type LineaBorrador,
} from './calculo-documento';
import { persistirAsiento } from './persistir-asiento';

const DOC_TYPES = [
  'FACTURA',
  'NOTA_CREDITO',
  'NOTA_DEBITO',
  'GUIA_DESPACHO',
  'PEDIDO',
  'PRESUPUESTO',
  'COMPRA',
  'NOTA_ENTREGA',
  'COMPROBANTE_RETENCION_IVA',
  'COMPROBANTE_RETENCION_ISLR',
] as const;

const MEDIOS_EMISION = ['FORMA_LIBRE', 'MAQUINA_FISCAL', 'IMPRENTA_DIGITAL'] as const;
const ALICUOTAS = ['GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'] as const;

interface EntradaEmision {
  companyId: string;
  seriesId: string;
  tipo: TipoDocumento;
  branchId: string | null;
  moneda: string;
  rateBcv: string | null;
  rateUsdMgmt: string;
  exchangeRateId: string | null;
  medioEmision: MedioEmision;
  numeroControl: string | null;
  paymentCondition: 'CONTADO' | 'CREDITO';
  issueDate: Date;
  partyId: string | null;
  adquirenteRif: string | null;
  adquirenteNombre: string | null;
  umbralConsumidorFinalVes: string | null;
  lineas: LineaBorrador[];
}

function parseLinea(raw: unknown, i: number): LineaBorrador {
  const b = asRecord(raw);
  return {
    itemId: optionalUuid(b.itemId, `lineas[${i}].itemId`),
    descripcion: requireString(b.descripcion, `lineas[${i}].descripcion`, 1000),
    cantidad: requireDecimal(b.cantidad, `lineas[${i}].cantidad`),
    precioUnitarioOrigen: requireDecimal(b.precioUnitarioOrigen, `lineas[${i}].precioUnitarioOrigen`, true),
    descuentoOrigen: optionalDecimal(b.descuentoOrigen, `lineas[${i}].descuentoOrigen`),
    alicuotaCodigo: requireEnum(b.alicuotaCodigo, `lineas[${i}].alicuotaCodigo`, ALICUOTAS, (s) => s.toUpperCase()),
    alicuotaTasa: requireDecimal(b.alicuotaTasa, `lineas[${i}].alicuotaTasa`, true),
  };
}

function parseEmision(body: unknown): EntradaEmision {
  const b = asRecord(body);
  const moneda = requireString(b.moneda, 'moneda', 12).toUpperCase();
  const esVes = moneda === 'VES';

  if (!Array.isArray(b.lineas) || b.lineas.length === 0) {
    throw new BadRequestException('El documento requiere al menos una línea');
  }

  const issueRaw = b.issueDate ?? b.fechaEmision;
  let issueDate: Date;
  if (issueRaw === undefined || issueRaw === null || String(issueRaw).trim() === '') {
    issueDate = new Date();
  } else {
    issueDate = new Date(String(issueRaw));
    if (Number.isNaN(issueDate.getTime())) {
      throw new BadRequestException(`issueDate inválida: ${String(issueRaw)}`);
    }
  }

  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    seriesId: requireUuid(b.seriesId, 'seriesId'),
    tipo: requireEnum(b.tipo, 'tipo', DOC_TYPES, (s) => s.toUpperCase()),
    branchId: optionalUuid(b.branchId, 'branchId'),
    moneda,
    // La tasa BCV es obligatoria para divisas; en VES no aplica.
    rateBcv: esVes ? null : requireDecimal(b.rateBcv, 'rateBcv'),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    exchangeRateId: optionalUuid(b.exchangeRateId, 'exchangeRateId'),
    medioEmision: requireEnumOpt(b.medioEmision, 'medioEmision', MEDIOS_EMISION, 'FORMA_LIBRE'),
    numeroControl: optionalString(b.numeroControl, 'numeroControl', 40),
    paymentCondition: requireEnum(b.paymentCondition, 'paymentCondition', ['CONTADO', 'CREDITO'] as const, (s) => s.toUpperCase()),
    issueDate,
    partyId: optionalUuid(b.partyId, 'partyId'),
    adquirenteRif: optionalString(b.adquirenteRif, 'adquirenteRif', 20),
    adquirenteNombre: optionalString(b.adquirenteNombre, 'adquirenteNombre', 500),
    umbralConsumidorFinalVes: optionalDecimal(b.umbralConsumidorFinalVes, 'umbralConsumidorFinalVes'),
    lineas: b.lineas.map(parseLinea),
  };
}

/** Enum opcional con default (no hay helper directo en validacion.ts). */
function requireEnumOpt<T extends string>(valor: unknown, campo: string, permitidos: readonly T[], def: T): T {
  if (valor === undefined || valor === null || String(valor).trim() === '') return def;
  return requireEnum(valor, campo, permitidos, (s) => s.toUpperCase());
}

/** Documento emitido devuelto al llamador. */
export interface DocumentoEmitido {
  documento: typeof documents.$inferSelect;
  lineas: (typeof documentLines.$inferSelect)[];
  impuestos: (typeof documentTaxes.$inferSelect)[];
}

/**
 * Emisión de documentos fiscales (P6, docs/05 §3.4 y §4). La emisión es una **transacción única**:
 * validación de requisitos (00071/00102) → asiento (partida doble) → consumo del correlativo
 * (contador transaccional, sin huecos) → documento ISSUED + líneas + impuestos → evento de
 * auditoría. Si algo falla, TODO revierte y el número NO se consume (regla 6, caso 24: resiliencia
 * a cortes de luz).
 *
 * Alcance P6: emisión de **FACTURA de venta** (el asiento de NC/ND/compras llega con las plantillas
 * de contabilización en P7+). El validador y el modelo soportan los demás tipos.
 */
@Injectable()
export class EmisionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async emitir(body: unknown): Promise<DocumentoEmitido> {
    const e = parseEmision(body);
    if (e.tipo !== 'FACTURA') {
      throw new BadRequestException('P6 solo emite FACTURA; NC/ND y otros tipos llegan en P7+');
    }

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const company = await cargarEmpresa(tx, e.companyId);
      const serie = await cargarSerie(tx, e.seriesId, e.companyId, e.tipo);
      if (e.branchId !== null) {
        await asegurarSucursal(tx, e.branchId, e.companyId);
      }
      const party = e.partyId !== null ? await cargarTercero(tx, e.partyId, e.companyId) : null;

      // 1) Cálculo multimoneda + IVA por alícuota (puro).
      const borrador: BorradorCalculo = {
        tipo: e.tipo,
        moneda: e.moneda,
        rateBcv: e.rateBcv,
        rateUsdMgmt: e.rateUsdMgmt,
        lineas: e.lineas,
      };
      const calc = calcularDocumento(borrador);

      // 2) Validador PRE-EMISIÓN (00071/00102). Antes de tocar la serie: una factura inválida no
      //    consume número ni bloquea la fila del contador.
      const incumplimientos = validarRequisitosFactura(construirProyeccion(e, company, party, calc));
      if (incumplimientos.length > 0) {
        throw new BadRequestException({
          message: 'El documento no cumple los requisitos de emisión (00071/00102)',
          incumplimientos,
        });
      }

      // 3) Período abierto + plan de cuentas de la empresa (para el asiento).
      const { anio, mes } = periodoFiscal(e.issueDate);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);
      const cuentas = await cargarCuentas(tx, e.companyId);

      // 4) Asiento de la factura (cuadra en triple base por construcción) → POSTED. El documento y
      //    su asiento comparten id de origen (`sourceId`) para el drill-down documento ↔ asiento.
      const docId = randomUUID();
      const entradaAsiento = armarAsientoFacturaVenta(calc, {
        fecha: e.issueDate,
        descripcion: `Factura ${serie.prefijo}${serie.nextNumber} a ${party?.razonSocial ?? 'consumidor final'}`,
        moneda: e.moneda,
        rateBcv: e.rateBcv,
        rateUsdMgmt: e.rateUsdMgmt,
        partyId: e.partyId,
        companyId: e.companyId,
        sourceId: docId,
      });
      const asiento = postear(Asiento.construir(entradaAsiento));
      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas,
      });

      // 5) Correlativo: consumo transaccional (§4). `RETURNING next_number` da el PRÓXIMO; el
      //    asignado es ese − 1. El UPDATE bloquea la fila (FOR UPDATE implícito) hasta el COMMIT:
      //    bajo concurrencia, cada emisión obtiene un número distinto y consecutivo (casos 21/53).
      const numero = await consumirNumero(tx, e.seriesId);

      // 6) Documento ISSUED (inmutable) + snapshots del adquirente + hash de integridad.
      const issueFechaFiscal = fechaFiscal(e.issueDate);
      const partyRif = party?.rif ?? e.adquirenteRif ?? null;
      const partyNombre = party?.razonSocial ?? e.adquirenteNombre ?? null;
      const hash = hashDocumento({
        companyId: e.companyId,
        seriesId: e.seriesId,
        numero,
        tipo: e.tipo,
        issueFechaFiscal,
        totalVes: calc.totales.totalVes,
        partyRif,
        impuestos: calc.impuestos,
      });

      const [documento] = await tx
        .insert(documents)
        .values({
          id: docId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          branchId: e.branchId,
          type: e.tipo,
          seriesId: e.seriesId,
          number: numero,
          controlNumber: e.numeroControl,
          status: 'ISSUED',
          medioEmision: e.medioEmision,
          partyId: e.partyId,
          partyRif,
          partyNombre,
          issueDate: e.issueDate,
          issueFechaFiscal,
          currency: e.moneda,
          exchangeRateId: e.exchangeRateId,
          rateBcv: e.rateBcv,
          rateUsdMgmt: e.rateUsdMgmt,
          paymentCondition: e.paymentCondition,
          journalEntryId: entryId,
          totalOrigen: calc.totales.totalOrigen,
          totalVes: calc.totales.totalVes,
          totalUsdMgmt: calc.totales.totalUsdMgmt,
          hashIntegridad: hash,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (documento === undefined) {
        throw new Error('No se pudo insertar el documento');
      }

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

      // 7) Auditoría (regla 5): append-only, atómico con la emisión.
      await this.audit.registrar(tx, {
        accion: 'document.issue',
        entidad: 'documents',
        entidadId: docId,
        after: documento,
      });

      return { documento, lineas, impuestos };
    });
  }
}

// ── Carga de referencias (todo bajo RLS, dentro de la transacción) ───────────────

async function cargarEmpresa(tx: DatabaseTx, companyId: string): Promise<typeof companies.$inferSelect> {
  const [row] = await tx.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (row === undefined) {
    throw new NotFoundException(`Empresa ${companyId} no encontrada`);
  }
  return row;
}

async function cargarSerie(
  tx: DatabaseTx,
  seriesId: string,
  companyId: string,
  tipo: TipoDocumento,
): Promise<typeof series.$inferSelect> {
  const [row] = await tx.select().from(series).where(eq(series.id, seriesId)).limit(1);
  if (row === undefined) {
    throw new NotFoundException(`Serie ${seriesId} no encontrada`);
  }
  if (row.companyId !== companyId) {
    throw new BadRequestException('La serie no pertenece a la empresa indicada');
  }
  if (row.docType !== tipo) {
    throw new BadRequestException(`La serie es de tipo ${row.docType}, no ${tipo}`);
  }
  if (!row.activo) {
    throw new BadRequestException('La serie está inactiva');
  }
  return row;
}

async function asegurarSucursal(tx: DatabaseTx, branchId: string, companyId: string): Promise<void> {
  const [row] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
    .limit(1);
  if (row === undefined) {
    throw new NotFoundException(`Sucursal ${branchId} no encontrada en la empresa`);
  }
}

async function cargarTercero(tx: DatabaseTx, partyId: string, companyId: string): Promise<typeof parties.$inferSelect> {
  const [row] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.companyId, companyId)))
    .limit(1);
  if (row === undefined) {
    throw new NotFoundException(`Tercero ${partyId} no encontrado en la empresa`);
  }
  return row;
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
  if (row.estado === 'CLOSED') {
    throw new BadRequestException(`El período ${anio}-${String(mes).padStart(2, '0')} está cerrado (regla 9)`);
  }
  return row.id;
}

async function cargarCuentas(tx: DatabaseTx, companyId: string): Promise<Map<string, string>> {
  const filas = await tx
    .select({ id: accounts.id, codigo: accounts.codigo })
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  return new Map(filas.map((f) => [f.codigo, f.id]));
}

/**
 * Consume el siguiente correlativo de la serie en la MISMA transacción (docs/05 §4). El UPDATE
 * incrementa `next_number` y bloquea la fila (FOR UPDATE implícito); el número asignado es el valor
 * PREVIO. Si la transacción no llega a COMMIT, el incremento se revierte y el número no se gasta.
 */
async function consumirNumero(tx: DatabaseTx, seriesId: string): Promise<number> {
  const [row] = await tx
    .update(series)
    .set({ nextNumber: sql`${series.nextNumber} + 1` })
    .where(and(eq(series.id, seriesId), eq(series.activo, true)))
    .returning({ siguiente: series.nextNumber });
  if (row === undefined) {
    throw new BadRequestException('No se pudo asignar el correlativo (serie inexistente o inactiva)');
  }
  return row.siguiente - 1;
}

/** Construye la proyección que consume el validador pre-emisión (importes en moneda origen). */
function construirProyeccion(
  e: EntradaEmision,
  company: typeof companies.$inferSelect,
  party: typeof parties.$inferSelect | null,
  calc: DocumentoCalculado,
): DocumentoAEmitir {
  const esConsumidorFinal = party === null;
  return {
    tipo: e.tipo,
    medioEmision: e.medioEmision,
    emisor: {
      razonSocial: company.razonSocial,
      rif: company.rif,
      domicilioFiscal: company.direccionFiscal,
    },
    numeroControl: e.numeroControl,
    adquirente: {
      esConsumidorFinal,
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

/** Hash de integridad SHA-256 del documento emitido (inalterabilidad, Providencia 121). */
function hashDocumento(datos: unknown): string {
  return createHash('sha256').update(JSON.stringify(datos)).digest('hex');
}
