import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  ALICUOTA_IGTF_DEFECTO,
  calcularDeclaracionIgtf,
  calcularPlanillaIva,
  type FilaIgtf,
  type ResultadoDeclaracionIgtf,
  type ResultadoPlanillaIva,
} from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { cobroMedios, cobros, companies, retentionsReceived, taxReturns } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { type Libro, LibrosService } from './libros.service';
import { etiquetaPeriodo, periodoAnterior, rangoPeriodo } from './periodo';

/** Planilla borrador de IVA (forma 99030) con su contexto y los resúmenes de libros que la sustentan. */
export interface PlanillaIvaBorrador {
  readonly tipo: 'IVA';
  readonly periodo: { readonly anio: number; readonly mes: number };
  readonly empresa: Libro['empresa'];
  readonly libroVentas: Libro['resumen'];
  readonly libroCompras: Libro['resumen'];
  readonly retencionesSoportadas: string;
  readonly planilla: ResultadoPlanillaIva;
  /** Cuadre contra los libros (docs/06 M7): debe ser exacto; si no, hay un bug. */
  readonly cuadre: { readonly debitoCuadra: boolean; readonly creditoCuadra: boolean };
}

/** Declaración borrador de IGTF percibido del período. */
export interface DeclaracionIgtfBorrador {
  readonly tipo: 'IGTF';
  readonly periodo: { readonly anio: number; readonly mes: number };
  readonly empresa: Libro['empresa'];
  readonly declaracion: ResultadoDeclaracionIgtf;
}

/**
 * Planillas borrador (IVA, IGTF) y presentación de declaraciones (P10, docs/02 §3.2/§5, docs/06 M7).
 * Todo se deriva de la única fuente de verdad (libros ← document/purchase_taxes; IGTF ← cobros), de
 * modo que el borrador cuadra con los libros por construcción (triple igualdad, docs/05 §7.3). Al
 * **presentar**, se congela un snapshot inmutable en `tax_returns` (Providencia 121).
 */
@Injectable()
export class DeclaracionesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly libros: LibrosService,
    private readonly audit: AuditService,
  ) {}

  /** Planilla borrador de IVA del período (débitos, créditos con prorrata, retenciones y excedentes). */
  async planillaIva(companyId: string, anio: number, mes: number): Promise<PlanillaIvaBorrador> {
    const ventas = await this.libros.libroVentas(companyId, anio, mes);
    const compras = await this.libros.libroCompras(companyId, anio, mes);

    const { retenciones, excedentes } = await withTenant(this.database.db, async (tx) => {
      const ret = await sumaRetencionesIvaSoportadas(tx, companyId, anio, mes);
      const exc = await excedentesAnteriores(tx, companyId, anio, mes);
      return { retenciones: ret, excedentes: exc };
    });

    // Para la prorrata: las exportaciones (0%) dan derecho a crédito → cuentan como gravadas.
    const ventasGravadas = new Decimal(ventas.resumen.baseGravada).plus(ventas.resumen.baseExportacion).toFixed(2);
    const planilla = calcularPlanillaIva({
      debito: ventas.resumen.grupos.map((g) => ({ alicuotaTasa: g.alicuotaTasa, base: g.base, monto: g.monto })),
      credito: compras.resumen.grupos.map((g) => ({ alicuotaTasa: g.alicuotaTasa, base: g.base, monto: g.monto })),
      ventasGravadas,
      ventasExentas: ventas.resumen.baseExenta,
      retencionesDelPeriodo: retenciones,
      excedenteCreditoAnterior: excedentes.credito,
      excedenteRetencionesAnterior: excedentes.retenciones,
    });

    return {
      tipo: 'IVA',
      periodo: { anio, mes },
      empresa: ventas.empresa,
      libroVentas: ventas.resumen,
      libroCompras: compras.resumen,
      retencionesSoportadas: retenciones,
      planilla,
      cuadre: {
        debitoCuadra: planilla.debitoFiscal === ventas.resumen.ivaTotal,
        creditoCuadra: planilla.creditoFiscalDelPeriodo === compras.resumen.ivaTotal,
      },
    };
  }

  /** Declaración borrador de IGTF percibido del período (causado al pago, docs/02 §5). */
  async declaracionIgtf(companyId: string, anio: number, mes: number): Promise<DeclaracionIgtfBorrador> {
    const { desde, hasta } = rangoPeriodo(anio, mes);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const empresa = await this.empresaCab(tx, companyId);

      const cobrosPeriodo = await tx
        .select()
        .from(cobros)
        .where(
          and(
            eq(cobros.companyId, companyId),
            eq(cobros.status, 'POSTED'),
            gte(cobros.fechaFiscal, desde),
            lt(cobros.fechaFiscal, hasta),
          ),
        )
        .orderBy(asc(cobros.fechaFiscal));
      const conIgtf = cobrosPeriodo.filter((c) => c.igtfTotalVes !== null && new Decimal(c.igtfTotalVes).gt(0));

      const medios = conIgtf.length === 0 ? [] : await tx.select().from(cobroMedios).where(inArray(cobroMedios.cobroId, conIgtf.map((c) => c.id)));

      const filas: FilaIgtf[] = conIgtf.map((c) => {
        const baseVes = medios
          .filter((m) => m.cobroId === c.id && m.causaIgtf && !m.esVuelto)
          .reduce((s, m) => s.plus(m.montoVes), new Decimal(0));
        const igtf = new Decimal(c.igtfTotalVes ?? '0');
        // Alícuota derivada del propio cobro (igtf/base×100); si no hay base, la de defecto.
        const alicuota = baseVes.gt(0) ? igtf.div(baseVes).times(100).toDecimalPlaces(2).toFixed() : String(ALICUOTA_IGTF_DEFECTO);
        return { alicuota, baseVes: baseVes.toFixed(2), igtfVes: igtf.toFixed(2) };
      });

      return {
        tipo: 'IGTF',
        periodo: { anio, mes },
        empresa,
        declaracion: calcularDeclaracionIgtf(filas),
      };
    });
  }

  /** Lista las declaraciones (borrador/presentadas) de la empresa. */
  async listar(companyId: string): Promise<(typeof taxReturns.$inferSelect)[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(taxReturns).where(eq(taxReturns.companyId, companyId)).orderBy(asc(taxReturns.periodoAnio), asc(taxReturns.periodoMes));
    });
  }

  /**
   * Marca una declaración como presentada: congela un snapshot inmutable de las cifras (planilla +
   * libros) en `tax_returns`. Idempotencia dura: el UNIQUE (company, tipo, período) impide presentar
   * dos veces el mismo período; una corrección se hace con declaración sustitutiva.
   */
  async presentar(input: {
    companyId: string;
    tipo: 'IVA' | 'IGTF';
    anio: number;
    mes: number;
    numeroDeclaracion: string | null;
  }): Promise<typeof taxReturns.$inferSelect> {
    const snapshotData =
      input.tipo === 'IVA'
        ? await this.planillaIva(input.companyId, input.anio, input.mes)
        : await this.declaracionIgtf(input.companyId, input.anio, input.mes);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, input.companyId);

      const existe = await tx
        .select({ id: taxReturns.id, status: taxReturns.status })
        .from(taxReturns)
        .where(
          and(
            eq(taxReturns.companyId, input.companyId),
            eq(taxReturns.tipo, input.tipo),
            eq(taxReturns.periodoAnio, input.anio),
            eq(taxReturns.periodoMes, input.mes),
          ),
        )
        .limit(1);
      if (existe.length > 0) {
        throw new ConflictException(
          `Ya existe una declaración de ${input.tipo} para ${etiquetaPeriodo(input.anio, input.mes)} (estado ${existe[0]!.status}); use una sustitutiva`,
        );
      }

      const snapshot = { generadoEn: new Date().toISOString(), ...snapshotData };
      const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

      const [row] = await tx
        .insert(taxReturns)
        .values({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          tipo: input.tipo,
          periodoAnio: input.anio,
          periodoMes: input.mes,
          status: 'PRESENTADA',
          numeroDeclaracion: input.numeroDeclaracion,
          snapshot,
          hashIntegridad: hash,
          presentadoAt: new Date(),
          presentadoPor: ctx.userId ?? null,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (row === undefined) throw new BadRequestException('No se pudo presentar la declaración');

      await this.audit.registrar(tx, { accion: 'declaracion.present', entidad: 'tax_returns', entidadId: row.id, after: { tipo: input.tipo, periodo: etiquetaPeriodo(input.anio, input.mes) } });
      return row;
    });
  }

  private async empresaCab(tx: DatabaseTx, companyId: string): Promise<Libro['empresa']> {
    const [c] = await tx.select({ rif: companies.rif, razonSocial: companies.razonSocial }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (c === undefined) throw new BadRequestException(`Empresa ${companyId} no encontrada`);
    return { rif: c.rif, razonSocial: c.razonSocial };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Σ de las retenciones de IVA soportadas (comprobantes recibidos) imputadas al período. */
async function sumaRetencionesIvaSoportadas(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<string> {
  const filas = await tx
    .select({ monto: retentionsReceived.montoVes })
    .from(retentionsReceived)
    .where(
      and(
        eq(retentionsReceived.companyId, companyId),
        eq(retentionsReceived.tipo, 'IVA'),
        eq(retentionsReceived.periodoAnio, anio),
        eq(retentionsReceived.periodoMes, mes),
      ),
    );
  return filas.reduce((s, f) => s.plus(f.monto), new Decimal(0)).toFixed(2);
}

/** Excedentes (crédito fiscal y retenciones) trasladados desde la declaración de IVA presentada del período anterior. */
async function excedentesAnteriores(
  tx: DatabaseTx,
  companyId: string,
  anio: number,
  mes: number,
): Promise<{ credito: string; retenciones: string }> {
  const prev = periodoAnterior(anio, mes);
  const [row] = await tx
    .select({ snapshot: taxReturns.snapshot })
    .from(taxReturns)
    .where(
      and(
        eq(taxReturns.companyId, companyId),
        eq(taxReturns.tipo, 'IVA'),
        eq(taxReturns.status, 'PRESENTADA'),
        eq(taxReturns.periodoAnio, prev.anio),
        eq(taxReturns.periodoMes, prev.mes),
      ),
    )
    .limit(1);
  const snap = row?.snapshot as { planilla?: ResultadoPlanillaIva } | null | undefined;
  const planilla = snap?.planilla;
  return {
    credito: planilla?.excedenteCreditoSiguiente ?? '0',
    retenciones: planilla?.excedenteRetencionesSiguiente ?? '0',
  };
}
