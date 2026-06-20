import { BadRequestException, Injectable } from '@nestjs/common';
import { consolidarArcIslr, type FilaArcIslr, type ResultadoArcIslr } from '@contave/fiscal-engine';
import { fechaFiscal } from '@contave/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, documents, parties, retentionsIssued, retentionsReceived } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { withTenant } from '../tenant/with-tenant';

/** Estados de un documento de venta ya emitido (causó efectos fiscales). */
const ESTADOS_EMITIDOS = ['ISSUED', 'APPLIED'] as const;
/** Umbral por defecto de "comprobante atrasado" (caso 28): facturas a SPE sin comprobante > 30 días. */
const DIAS_UMBRAL_DEFECTO = 30;

/** Una factura emitida a un cliente agente (SPE) que aún no tiene comprobante de retención recibido. */
export interface FacturaAspeSinComprobante {
  readonly documentId: string;
  readonly numero: number | null;
  readonly fechaFiscal: string;
  readonly clienteRif: string | null;
  readonly clienteNombre: string | null;
  readonly totalVes: string | null;
  /** Días transcurridos desde la fecha fiscal de la factura hasta hoy (Caracas). */
  readonly diasTranscurridos: number;
  /** true si supera el umbral configurado (≥ días) — debe gestionarse con el cliente. */
  readonly vencida: boolean;
}

export interface ControlFacturasAspe {
  readonly umbralDias: number;
  readonly hoy: string;
  /** Solo las facturas que superan el umbral (las "atrasadas"). */
  readonly facturas: FacturaAspeSinComprobante[];
  /** Total de facturas a SPE sin comprobante (incluye las que aún no superan el umbral). */
  readonly totalSinComprobante: number;
}

/** ARC anual de ISLR de un proveedor (sujeto retenido). */
export interface ArcProveedor {
  readonly partyId: string;
  readonly proveedorRif: string;
  readonly proveedorNombre: string;
  readonly arc: ResultadoArcIslr;
}

/**
 * Reportes de control de retenciones (P22, docs/02 §3.3/§4; casos 28 y 30 del doc 07):
 *  - **Caso 28**: facturas emitidas a clientes agentes (SPE) que todavía no tienen comprobante de
 *    retención recibido; las que superan los 30 días se marcan como vencidas para reclamarlas (el
 *    comprobante se imputa en el período en que se recibe, no en el de la factura).
 *  - **ARC anual de ISLR**: consolida las retenciones de ISLR emitidas a cada proveedor en un
 *    ejercicio (docs/02 §4: "el agente emite el ARC anual a cada proveedor").
 * Todo bajo RLS; el cálculo de agregación es puro (motor fiscal).
 */
@Injectable()
export class RetencionesControlService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Facturas a clientes SPE sin comprobante de retención de IVA recibido (caso 28). `umbralDias`
   * (default 30) define cuáles se reportan como vencidas. La fecha de corte es hoy en Caracas.
   */
  async facturasAspeSinComprobante(companyId: string, umbralDias = DIAS_UMBRAL_DEFECTO): Promise<ControlFacturasAspe> {
    if (!Number.isInteger(umbralDias) || umbralDias < 0) {
      throw new BadRequestException('umbralDias debe ser un entero ≥ 0');
    }
    const hoy = fechaFiscal(new Date());

    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);

      const filas = await tx
        .select({
          documentId: documents.id,
          numero: documents.number,
          fechaFiscal: documents.issueFechaFiscal,
          clienteRif: documents.partyRif,
          clienteNombre: documents.partyNombre,
          totalVes: documents.totalVes,
        })
        .from(documents)
        .innerJoin(parties, eq(parties.id, documents.partyId))
        .leftJoin(retentionsReceived, and(eq(retentionsReceived.documentId, documents.id), eq(retentionsReceived.tipo, 'IVA')))
        .where(
          and(
            eq(documents.companyId, companyId),
            eq(documents.type, 'FACTURA'),
            inArray(documents.status, [...ESTADOS_EMITIDOS]),
            eq(parties.esAgenteRetencionIva, true),
            isNull(retentionsReceived.id),
          ),
        );

      const todas: FacturaAspeSinComprobante[] = filas.map((f) => {
        const dias = diferenciaDias(f.fechaFiscal, hoy);
        return {
          documentId: f.documentId,
          numero: f.numero,
          fechaFiscal: f.fechaFiscal,
          clienteRif: f.clienteRif,
          clienteNombre: f.clienteNombre,
          totalVes: f.totalVes,
          diasTranscurridos: dias,
          vencida: dias >= umbralDias,
        };
      });

      return {
        umbralDias,
        hoy,
        facturas: todas.filter((f) => f.vencida).sort((a, b) => b.diasTranscurridos - a.diasTranscurridos),
        totalSinComprobante: todas.length,
      };
    });
  }

  /**
   * ARC anual de ISLR por proveedor del ejercicio (período de imputación = año). Si se pasa `partyId`
   * devuelve solo ese proveedor. Consolida `retentions_issued` (tipo ISLR) con el motor puro.
   */
  async arcIslrProveedores(companyId: string, ejercicio: number, partyId?: string | null): Promise<ArcProveedor[]> {
    if (!Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 2100) {
      throw new BadRequestException(`ejercicio inválido: ${ejercicio}`);
    }
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);

      const condiciones = [
        eq(retentionsIssued.companyId, companyId),
        eq(retentionsIssued.tipo, 'ISLR'),
        eq(retentionsIssued.periodoAnio, ejercicio),
      ];
      if (partyId != null && partyId !== '') condiciones.push(eq(retentionsIssued.partyId, partyId));

      const filas = await tx
        .select({
          partyId: retentionsIssued.partyId,
          proveedorRif: retentionsIssued.proveedorRif,
          proveedorNombre: retentionsIssued.proveedorNombre,
          mes: retentionsIssued.periodoMes,
          concepto: retentionsIssued.conceptoIslr,
          baseVes: retentionsIssued.baseVes,
          montoVes: retentionsIssued.montoVes,
        })
        .from(retentionsIssued)
        .where(and(...condiciones));

      return agruparPorProveedor(filas);
    });
  }

  /** Cabecera de empresa (para encabezar el ARC en PDF/Excel). */
  async empresaCab(companyId: string): Promise<{ rif: string; razonSocial: string }> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return cargarEmpresa(tx, companyId);
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FilaArcDb {
  partyId: string;
  proveedorRif: string;
  proveedorNombre: string;
  mes: number;
  concepto: string | null;
  baseVes: string;
  montoVes: string;
}

/** Agrupa las retenciones por proveedor y consolida el ARC de cada uno (motor puro). */
function agruparPorProveedor(filas: FilaArcDb[]): ArcProveedor[] {
  const porProveedor = new Map<string, { rif: string; nombre: string; filas: FilaArcIslr[] }>();
  for (const f of filas) {
    const g = porProveedor.get(f.partyId) ?? { rif: f.proveedorRif, nombre: f.proveedorNombre, filas: [] };
    g.filas.push({ mes: f.mes, concepto: f.concepto ?? 'SIN_CONCEPTO', baseVes: f.baseVes, montoVes: f.montoVes });
    porProveedor.set(f.partyId, g);
  }
  return [...porProveedor.entries()]
    .map(([partyId, g]) => ({ partyId, proveedorRif: g.rif, proveedorNombre: g.nombre, arc: consolidarArcIslr(g.filas) }))
    .sort((a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre));
}

/** Diferencia en días entre dos fechas fiscales `YYYY-MM-DD` (hasta − desde), en días civiles. */
function diferenciaDias(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

async function cargarEmpresa(tx: DatabaseTx, companyId: string): Promise<{ rif: string; razonSocial: string }> {
  const [c] = await tx.select({ rif: companies.rif, razonSocial: companies.razonSocial }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (c === undefined) throw new BadRequestException(`Empresa ${companyId} no encontrada`);
  return { rif: c.rif, razonSocial: c.razonSocial };
}
