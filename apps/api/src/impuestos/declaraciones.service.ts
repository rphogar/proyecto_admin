import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  ALICUOTA_IGTF_DEFECTO,
  calcularAnticipo,
  calcularDeclaracionIgtf,
  calcularPlanillaIva,
  type FilaIgtf,
  type ResultadoAnticipo,
  type ResultadoDeclaracionIgtf,
  type ResultadoPlanillaIva,
  type TipoAnticipo,
} from '@contave/fiscal-engine';
import { Decimal } from '@contave/shared';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { cobroMedios, cobros, companies, fiscalParams, retentionsReceived, taxReturns } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import type { EntradaCalendarioSpe } from '../portal/obligaciones';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { type Cadencia, resolverParametroAnticipo, ventanaFraccion } from './anticipos-comun';
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

/** Borrador de anticipo de IVA/ISLR de SPE para una fracción (quincena/semana) del mes (P21). */
export interface AnticipoBorrador {
  readonly tipo: TipoAnticipo;
  readonly periodo: { readonly anio: number; readonly mes: number; readonly subperiodo: number };
  readonly empresa: Libro['empresa'];
  readonly cadencia: Cadencia;
  /** Ventana de fecha fiscal `[desde, hasta)` (Caracas) de la fracción. */
  readonly ventana: { readonly desde: string; readonly hasta: string };
  readonly ingresosBrutos: string;
  readonly operaciones: number;
  /** true si el porcentaje/cadencia vienen del default TODO-TRIBUTARISTA (sin parámetro sembrado). */
  readonly parametroPorDefecto: boolean;
  readonly anticipo: ResultadoAnticipo;
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
    // Exentas y exoneradas (ambas sin derecho a crédito) cuentan como no gravadas en la prorrata.
    const ventasExentas = new Decimal(ventas.resumen.baseExenta).plus(ventas.resumen.baseExonerada).toFixed(2);
    const planilla = calcularPlanillaIva({
      debito: ventas.resumen.grupos.map((g) => ({ alicuotaTasa: g.alicuotaTasa, base: g.base, monto: g.monto })),
      credito: compras.resumen.grupos.map((g) => ({ alicuotaTasa: g.alicuotaTasa, base: g.base, monto: g.monto })),
      ventasGravadas,
      ventasExentas,
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

  /**
   * Borrador del anticipo de IVA/ISLR de SPE para una fracción del mes (P21, docs/02 §3.2/§10). El
   * anticipo se calcula sobre los **ingresos brutos** de la ventana (base del Libro de Ventas, sin IGTF
   * → no se duplica con la declaración de IGTF, casos 34/35), a la alícuota de la providencia vigente.
   */
  async anticipoBorrador(
    companyId: string,
    tipo: TipoAnticipo,
    anio: number,
    mes: number,
    subperiodo: number,
  ): Promise<AnticipoBorrador> {
    const fechaVigencia = rangoPeriodo(anio, mes).desde;
    const { empresa, parametro } = await withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return { empresa: await this.empresaCab(tx, companyId), parametro: await resolverParametroAnticipo(tx, tipo, fechaVigencia) };
    });

    const ventana = ventanaFraccion(anio, mes, parametro.cadencia, subperiodo);
    const { base, operaciones } = await this.libros.ingresosBrutosVentas(companyId, ventana.desde, ventana.hasta);
    const anticipo = calcularAnticipo({ ingresosBrutos: base, porcentaje: parametro.porcentaje });

    return {
      tipo,
      periodo: { anio, mes, subperiodo },
      empresa,
      cadencia: parametro.cadencia,
      ventana,
      ingresosBrutos: base,
      operaciones,
      parametroPorDefecto: parametro.esDefecto,
      anticipo,
    };
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
    tipo: 'IVA' | 'IGTF' | TipoAnticipo;
    anio: number;
    mes: number;
    /** Fracción (quincena/semana) para los anticipos; 0 = declaración mensual (IVA/IGTF). */
    subperiodo?: number;
    numeroDeclaracion: string | null;
  }): Promise<typeof taxReturns.$inferSelect> {
    const esAnticipo = input.tipo === 'ANTICIPO_IVA' || input.tipo === 'ANTICIPO_ISLR';
    const subperiodo = input.subperiodo ?? 0;
    if (esAnticipo && subperiodo < 1) {
      throw new BadRequestException('un anticipo requiere subperiodo ≥ 1 (la fracción quincenal/semanal)');
    }
    if (!esAnticipo && subperiodo !== 0) {
      throw new BadRequestException('una declaración mensual no lleva subperiodo');
    }

    const snapshotData = esAnticipo
      ? await this.anticipoBorrador(input.companyId, input.tipo as TipoAnticipo, input.anio, input.mes, subperiodo)
      : input.tipo === 'IVA'
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
            eq(taxReturns.subperiodo, subperiodo),
          ),
        )
        .limit(1);
      if (existe.length > 0) {
        const frac = esAnticipo ? ` fracción ${subperiodo}` : '';
        throw new ConflictException(
          `Ya existe una declaración de ${input.tipo} para ${etiquetaPeriodo(input.anio, input.mes)}${frac} (estado ${existe[0]!.status}); use una sustitutiva`,
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
          subperiodo,
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

      await this.audit.registrar(tx, { accion: 'declaracion.present', entidad: 'tax_returns', entidadId: row.id, after: { tipo: input.tipo, periodo: etiquetaPeriodo(input.anio, input.mes), subperiodo } });
      return row;
    });
  }

  /** Devuelve el calendario SPE (parámetro `CALENDARIO_SPE`) vigente al 1 de enero del año dado. */
  async obtenerCalendarioSpe(anio: number): Promise<EntradaCalendarioSpe[]> {
    return withTenant(this.database.db, async (tx) => {
      const [row] = await tx
        .select({ valor: fiscalParams.valor })
        .from(fiscalParams)
        .where(and(eq(fiscalParams.clave, CLAVE_CALENDARIO_SPE), eq(fiscalParams.vigenteDesde, `${anio}-01-01`)))
        .limit(1);
      return Array.isArray(row?.valor) ? (row!.valor as EntradaCalendarioSpe[]) : [];
    });
  }

  /**
   * Importa el calendario SPE de un año como datos por providencia (regla 17): lo guarda en
   * `fiscal_params` con vigencia anual. Idempotente: reemplaza el del mismo año si ya existía. Nunca
   * hardcode — las fechas las suministra el usuario/providencia.
   */
  async importarCalendarioSpe(anio: number, entradas: EntradaCalendarioSpe[]): Promise<{ anio: number; entradas: number }> {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) throw new BadRequestException(`Año inválido: ${anio}`);
    const validas = entradas.map(validarEntradaCalendario);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const desde = `${anio}-01-01`;
      const hasta = `${anio + 1}-01-01`;
      // Reemplazo idempotente del año (la EXCLUDE de vigencias impide solapes; se borra y reinserta).
      await tx.delete(fiscalParams).where(and(eq(fiscalParams.clave, CLAVE_CALENDARIO_SPE), eq(fiscalParams.vigenteDesde, desde)));
      await tx.insert(fiscalParams).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        clave: CLAVE_CALENDARIO_SPE,
        valor: validas,
        vigenteDesde: desde,
        vigenteHasta: hasta,
      });
      await this.audit.registrar(tx, { accion: 'calendario.import', entidad: 'fiscal_params', after: { clave: CLAVE_CALENDARIO_SPE, anio, entradas: validas.length } });
      return { anio, entradas: validas.length };
    });
  }

  private async empresaCab(tx: DatabaseTx, companyId: string): Promise<Libro['empresa']> {
    const [c] = await tx.select({ rif: companies.rif, razonSocial: companies.razonSocial }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (c === undefined) throw new BadRequestException(`Empresa ${companyId} no encontrada`);
    return { rif: c.rif, razonSocial: c.razonSocial };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clave del parámetro `fiscal_params` que guarda el calendario SPE importado por providencia. */
const CLAVE_CALENDARIO_SPE = 'CALENDARIO_SPE';

/** Valida una entrada del calendario SPE recibida en la importación (datos por providencia). */
function validarEntradaCalendario(raw: unknown, i: number): EntradaCalendarioSpe {
  if (typeof raw !== 'object' || raw === null) throw new BadRequestException(`calendario[${i}] inválido`);
  const e = raw as Record<string, unknown>;
  const terminalRif = String(e.terminalRif ?? '');
  if (!/^[0-9]$/.test(terminalRif)) throw new BadRequestException(`calendario[${i}].terminalRif debe ser un dígito 0-9`);
  const tipo = String(e.tipo ?? '');
  if (tipo === '') throw new BadRequestException(`calendario[${i}].tipo es obligatorio`);
  const periodoAnio = Number(e.periodoAnio);
  const periodoMes = Number(e.periodoMes);
  if (!Number.isInteger(periodoAnio) || !Number.isInteger(periodoMes) || periodoMes < 1 || periodoMes > 12) {
    throw new BadRequestException(`calendario[${i}] período inválido`);
  }
  const fechaLimite = String(e.fechaLimite ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimite)) throw new BadRequestException(`calendario[${i}].fechaLimite debe ser YYYY-MM-DD`);
  const subperiodo = e.subperiodo === undefined || e.subperiodo === null ? undefined : Number(e.subperiodo);
  if (subperiodo !== undefined && (!Number.isInteger(subperiodo) || subperiodo < 0)) {
    throw new BadRequestException(`calendario[${i}].subperiodo debe ser un entero ≥ 0`);
  }
  return { terminalRif, tipo, periodoAnio, periodoMes, fechaLimite, ...(subperiodo === undefined ? {} : { subperiodo }) };
}

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
