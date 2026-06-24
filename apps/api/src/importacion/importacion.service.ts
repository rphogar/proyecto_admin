import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@contave/shared';
import { desc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, items, itemPrices, parties, priceLists } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireDecimal, requireString, requireUuid } from '../maestros/validacion';
import type { EntradaLinea } from '@contave/ledger';
import { construirAsientoApertura, type RenglonApertura } from '../onboarding/asiento-apertura';
import { OnboardingService, type ResultadoApertura } from '../onboarding/onboarding.service';
import { almacenPrincipalId } from '../onboarding/precarga';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { construirRenglonesApertura, type MapasResolucion } from './apertura-importacion';
import {
  type CuentaAbiertaValidada,
  type ErrorFila,
  type ItemValidado,
  mapearCuentasAbiertas,
  mapearItems,
  mapearSaldos,
  mapearTerceros,
  type ReporteDryRun,
  reporteVacio,
  type SaldoValidado,
  type TerceroValidado,
} from './mapeo';
import { ESCALAS_MONETARIAS, type EscalaMonetaria } from './parsers/normalizar';
import { parsearMigracion } from './parsers/registro';
import type { CuentaAbiertaCruda, FilaCruda, ItemCrudo, SaldoCrudo, TerceroCrudo } from './parsers/tipos';

const ESCALAS = Object.keys(ESCALAS_MONETARIAS) as EscalaMonetaria[];

interface Archivo {
  readonly archivoNombre: string;
  readonly contenido: string;
  readonly sistema: string | null;
  readonly escala: EscalaMonetaria | undefined;
}

function parseEscala(valor: unknown): EscalaMonetaria | undefined {
  if (valor === undefined || valor === null || String(valor).trim() === '') return undefined;
  const v = String(valor).trim().toUpperCase();
  if (!ESCALAS.includes(v as EscalaMonetaria)) {
    throw new BadRequestException(`escala inválida: "${String(valor)}" (use ${ESCALAS.join(', ')})`);
  }
  return v as EscalaMonetaria;
}

function parseArchivo(body: unknown): Archivo & { companyId: string } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    archivoNombre: requireString(b.archivoNombre, 'archivoNombre', 200),
    contenido: requireString(b.contenido, 'contenido', 20_000_000),
    sistema: optionalString(b.sistema, 'sistema', 20)?.toUpperCase() ?? null,
    escala: parseEscala(b.escala),
  };
}

export interface ResultadoCommit<T> {
  readonly reporte: ReporteDryRun<T>;
  readonly insertadas: number;
}

/**
 * Importadores de migración desde otro sistema (P31, casos 45–46, docs/02 §9, docs/05 §5). Para un
 * cliente que viene de Gálac/Profit/Excel: **terceros** (dedup por RIF), **ítems** (con costo y
 * alícuota), **CxC/CxP abiertas** y **saldos iniciales** que se integran al asiento de apertura (P30).
 * Cada entidad ofrece **dry-run** (vista previa en seco, sin escribir, con reporte de errores por fila)
 * y **commit**. Todo bajo `withTenant` (RLS) y auditado en la misma transacción (regla 5).
 */
@Injectable()
export class ImportacionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
  ) {}

  // --- TERCEROS ------------------------------------------------------------------------------------

  async dryRunTerceros(body: unknown): Promise<ReporteDryRun<TerceroValidado>> {
    const a = parseArchivo(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, a.companyId);
      const filas = this.parseTerceros(a);
      const existentes = await this.rifsExistentes(tx, a.companyId);
      return mapearTerceros(filas, { escala: a.escala, existentes });
    });
  }

  async commitTerceros(body: unknown): Promise<ResultadoCommit<TerceroValidado>> {
    const a = parseArchivo(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, a.companyId);
      const filas = this.parseTerceros(a);
      const existentes = await this.rifsExistentes(tx, a.companyId);
      const reporte = mapearTerceros(filas, { escala: a.escala, existentes });
      if (reporte.validas.length === 0) return { reporte, insertadas: 0 };

      const valores = reporte.validas.map(({ datos: t }) => ({
        tenantId: ctx.tenantId,
        companyId: a.companyId,
        tipo: t.tipo,
        rif: t.rif,
        razonSocial: t.razonSocial,
        condicionIva: t.condicionIva,
        esAgenteRetencionIva: t.esAgenteRetencionIva,
        pctRetencionIva: t.pctRetencionIva,
        esAgenteRetencionIslr: t.esAgenteRetencionIslr,
        direccionFiscal: t.direccionFiscal,
        email: t.email,
        telefono: t.telefono,
        diasCredito: t.diasCredito,
      }));
      const insertadas = await tx
        .insert(parties)
        .values(valores)
        .onConflictDoNothing({ target: [parties.companyId, parties.rif] })
        .returning({ id: parties.id });

      await this.audit.registrar(tx, {
        accion: 'migracion.terceros',
        entidad: 'parties',
        entidadId: a.companyId,
        after: { archivo: a.archivoNombre, total: reporte.total, insertadas: insertadas.length, errores: reporte.errores.length },
      });
      return { reporte, insertadas: insertadas.length };
    });
  }

  // --- ÍTEMS ---------------------------------------------------------------------------------------

  async dryRunItems(body: unknown): Promise<ReporteDryRun<ItemValidado>> {
    const a = parseArchivo(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, a.companyId);
      const filas = this.parseItems(a);
      const existentes = await this.skusExistentes(tx, a.companyId);
      return mapearItems(filas, { escala: a.escala, existentes });
    });
  }

  async commitItems(body: unknown): Promise<ResultadoCommit<ItemValidado> & { preciosCargados: number }> {
    const a = parseArchivo(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, a.companyId);
      const filas = this.parseItems(a);
      const existentes = await this.skusExistentes(tx, a.companyId);
      const reporte = mapearItems(filas, { escala: a.escala, existentes });
      if (reporte.validas.length === 0) return { reporte, insertadas: 0, preciosCargados: 0 };

      const insertados = await tx
        .insert(items)
        .values(
          reporte.validas.map(({ datos: it }) => ({
            tenantId: ctx.tenantId,
            companyId: a.companyId,
            sku: it.sku,
            descripcion: it.descripcion,
            tipo: it.tipo,
            alicuotaIva: it.alicuotaIva,
            unidad: it.unidad,
          })),
        )
        .onConflictDoNothing({ target: [items.companyId, items.sku] })
        .returning({ id: items.id, sku: items.sku });

      // Precios: a la lista por defecto de la empresa (si existe), solo para los ítems con precio.
      const preciosCargados = await this.cargarPrecios(tx, ctx.tenantId, a.companyId, reporte.validas, insertados);

      await this.audit.registrar(tx, {
        accion: 'migracion.items',
        entidad: 'items',
        entidadId: a.companyId,
        after: { archivo: a.archivoNombre, total: reporte.total, insertados: insertados.length, preciosCargados, errores: reporte.errores.length },
      });
      return { reporte, insertadas: insertados.length, preciosCargados };
    });
  }

  // --- APERTURA (saldos + CxC + CxP) ---------------------------------------------------------------

  /** Vista previa en seco del asiento de apertura migrado: renglones, errores por fila y cuadre. */
  async dryRunApertura(body: unknown): Promise<ResultadoDryRunApertura> {
    const e = parseApertura(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const { renglones, errores } = await this.armarRenglones(tx, e);
      const erroresCuenta = await this.validarCuentas(tx, e.companyId, renglones, errores);

      if (renglones.length === 0) {
        return { renglones: 0, errores: erroresCuenta, lineas: 0, cuadraVes: false, cuadraUsd: false };
      }
      try {
        const { entradaAsiento } = construirAsientoApertura({
          fecha: new Date(),
          renglones,
          capitalVes: e.capitalVes,
          rateUsdMgmt: e.rateUsdMgmt,
          companyId: e.companyId,
        });
        const cuadraVes = cuadra(entradaAsiento.lineas, 'montoVes');
        const cuadraUsd = cuadra(entradaAsiento.lineas, 'montoUsdMgmt');
        return { renglones: renglones.length, errores: erroresCuenta, lineas: entradaAsiento.lineas.length, cuadraVes, cuadraUsd };
      } catch (err) {
        // El motor del asiento rechazó los renglones (p. ej. inventario sin almacén): se reporta, no se rompe.
        return {
          renglones: renglones.length,
          errores: [...erroresCuenta, { fila: 0, mensaje: (err as Error).message }],
          lineas: 0,
          cuadraVes: false,
          cuadraUsd: false,
        };
      }
    });
  }

  /** Confirma la migración de saldos: construye los renglones y delega en el asiento de apertura (P30). */
  async commitApertura(body: unknown): Promise<ResultadoApertura & { renglones: number }> {
    const e = parseApertura(body);
    const { renglones, errores } = await withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const r = await this.armarRenglones(tx, e);
      const err = await this.validarCuentas(tx, e.companyId, r.renglones, r.errores);
      return { renglones: r.renglones, errores: err };
    });
    if (errores.length > 0) {
      throw new BadRequestException({
        message: 'La apertura migrada tiene filas con error; corríjalas antes de confirmar',
        errores,
        regla: 'caso-45',
      });
    }
    if (renglones.length === 0) {
      throw new BadRequestException('No hay saldos válidos para la apertura');
    }
    const apertura = await this.onboarding.registrarSaldosIniciales({
      companyId: e.companyId,
      fechaApertura: e.fechaApertura,
      capitalVes: e.capitalVes,
      rateUsdMgmt: e.rateUsdMgmt,
      renglones,
    });
    return { ...apertura, renglones: renglones.length };
  }

  // --- internos ------------------------------------------------------------------------------------

  private parseTerceros(a: Archivo): Array<FilaCruda<TerceroCrudo>> {
    return parsearMigracion<TerceroCrudo>('TERCEROS', a.contenido, a.archivoNombre, a.sistema ?? undefined).filas;
  }

  private parseItems(a: Archivo): Array<FilaCruda<ItemCrudo>> {
    return parsearMigracion<ItemCrudo>('ITEMS', a.contenido, a.archivoNombre, a.sistema ?? undefined).filas;
  }

  private async armarRenglones(tx: DatabaseTx, e: EntradaApertura): Promise<{ renglones: RenglonApertura[]; errores: ErrorFila[] }> {
    const saldos = e.saldos !== null ? this.validarSaldos(e.saldos) : reporteVacio<SaldoValidado>();
    const cxc = e.cxc !== null ? this.validarCuentasAbiertas('CXC', e.cxc) : reporteVacio<CuentaAbiertaValidada>();
    const cxp = e.cxp !== null ? this.validarCuentasAbiertas('CXP', e.cxp) : reporteVacio<CuentaAbiertaValidada>();
    const erroresMapeo = [...saldos.errores, ...cxc.errores, ...cxp.errores];

    const mapas = await this.cargarMapas(tx, e.companyId);
    const { renglones, errores } = construirRenglonesApertura(saldos.validas, cxc.validas, cxp.validas, mapas);
    return { renglones, errores: [...erroresMapeo, ...errores] };
  }

  private validarSaldos(a: Archivo): ReporteDryRun<SaldoValidado> {
    const filas = parsearMigracion<SaldoCrudo>('SALDOS', a.contenido, a.archivoNombre, a.sistema ?? undefined).filas;
    return mapearSaldos(filas, { escala: a.escala });
  }

  private validarCuentasAbiertas(entidad: 'CXC' | 'CXP', a: Archivo): ReporteDryRun<CuentaAbiertaValidada> {
    const filas = parsearMigracion<CuentaAbiertaCruda>(entidad, a.contenido, a.archivoNombre, a.sistema ?? undefined).filas;
    return mapearCuentasAbiertas(filas, { escala: a.escala });
  }

  private async cargarMapas(tx: DatabaseTx, companyId: string): Promise<MapasResolucion> {
    const ps = await tx.select({ rif: parties.rif, id: parties.id }).from(parties).where(eq(parties.companyId, companyId));
    const its = await tx.select({ sku: items.sku, id: items.id }).from(items).where(eq(items.companyId, companyId));
    const warehousePrincipalId = await almacenPrincipalId(tx, companyId);
    return {
      partyPorRif: new Map(ps.map((p) => [p.rif, p.id])),
      itemPorSku: new Map(its.map((i) => [i.sku, i.id])),
      warehousePrincipalId,
    };
  }

  /** Marca como error las cuentas que no existen o no son de movimiento (hoja) en el plan. */
  private async validarCuentas(
    tx: DatabaseTx,
    companyId: string,
    renglones: ReadonlyArray<RenglonApertura>,
    erroresPrevios: ErrorFila[],
  ): Promise<ErrorFila[]> {
    const filas = await tx
      .select({ codigo: accounts.codigo, esMovimiento: accounts.esMovimiento })
      .from(accounts)
      .where(eq(accounts.companyId, companyId));
    const movimiento = new Set(filas.filter((f) => f.esMovimiento).map((f) => f.codigo));
    const errores = [...erroresPrevios];
    renglones.forEach((r, i) => {
      if (!movimiento.has(r.cuenta)) {
        errores.push({ fila: i + 1, campo: 'cuenta', mensaje: `la cuenta "${r.cuenta}" no existe o no es de movimiento` });
      }
    });
    return errores;
  }

  private async cargarPrecios(
    tx: DatabaseTx,
    tenantId: string,
    companyId: string,
    validas: ReporteDryRun<ItemValidado>['validas'],
    insertados: Array<{ id: string; sku: string }>,
  ): Promise<number> {
    const conPrecio = validas.filter((v) => v.datos.precio !== null);
    if (conPrecio.length === 0 || insertados.length === 0) return 0;
    // Prefiere la lista marcada por defecto; si no hay, cualquiera de la empresa.
    const [lista] = await tx
      .select({ id: priceLists.id })
      .from(priceLists)
      .where(eq(priceLists.companyId, companyId))
      .orderBy(desc(priceLists.esDefault))
      .limit(1);
    if (lista === undefined) return 0;
    const idPorSku = new Map(insertados.map((i) => [i.sku, i.id]));
    const valores = conPrecio
      .filter((v) => idPorSku.has(v.datos.sku))
      .map((v) => ({
        tenantId,
        companyId,
        priceListId: lista.id,
        itemId: idPorSku.get(v.datos.sku) as string,
        precio: v.datos.precio as string,
      }));
    if (valores.length === 0) return 0;
    const ins = await tx
      .insert(itemPrices)
      .values(valores)
      .onConflictDoNothing({ target: [itemPrices.priceListId, itemPrices.itemId] })
      .returning({ id: itemPrices.id });
    return ins.length;
  }

  private async rifsExistentes(tx: DatabaseTx, companyId: string): Promise<Set<string>> {
    const filas = await tx.select({ rif: parties.rif }).from(parties).where(eq(parties.companyId, companyId));
    return new Set(filas.map((f) => f.rif));
  }

  private async skusExistentes(tx: DatabaseTx, companyId: string): Promise<Set<string>> {
    const filas = await tx.select({ sku: items.sku }).from(items).where(eq(items.companyId, companyId));
    return new Set(filas.map((f) => f.sku));
  }
}

export interface ResultadoDryRunApertura {
  readonly renglones: number;
  readonly errores: ErrorFila[];
  readonly lineas: number;
  readonly cuadraVes: boolean;
  readonly cuadraUsd: boolean;
}

interface EntradaApertura {
  readonly companyId: string;
  readonly fechaApertura: string;
  readonly capitalVes: string;
  readonly rateUsdMgmt: string;
  readonly saldos: Archivo | null;
  readonly cxc: Archivo | null;
  readonly cxp: Archivo | null;
}

function parseArchivoOpcional(valor: unknown, companyId: string, sistema: string | null, escala: EscalaMonetaria | undefined): Archivo | null {
  if (valor === undefined || valor === null) return null;
  const b = asRecord(valor);
  if (b.contenido === undefined || String(b.contenido).trim() === '') return null;
  return {
    archivoNombre: requireString(b.archivoNombre ?? 'archivo.csv', 'archivoNombre', 200),
    contenido: requireString(b.contenido, 'contenido', 20_000_000),
    sistema: optionalString(b.sistema, 'sistema', 20)?.toUpperCase() ?? sistema,
    escala: b.escala !== undefined ? parseEscala(b.escala) : escala,
  };
}

function parseApertura(body: unknown): EntradaApertura {
  const b = asRecord(body);
  const companyId = requireUuid(b.companyId, 'companyId');
  const sistema = optionalString(b.sistema, 'sistema', 20)?.toUpperCase() ?? null;
  const escala = parseEscala(b.escala);
  return {
    companyId,
    fechaApertura: requireString(b.fechaApertura, 'fechaApertura', 10),
    capitalVes: requireDecimal(b.capitalVes, 'capitalVes', true),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    saldos: parseArchivoOpcional(b.saldos, companyId, sistema, escala),
    cxc: parseArchivoOpcional(b.cxc, companyId, sistema, escala),
    cxp: parseArchivoOpcional(b.cxp, companyId, sistema, escala),
  };
}

/** Suma D y C de una columna de montos y devuelve si cuadra (tolerancia 0). */
function cuadra(lineas: ReadonlyArray<EntradaLinea>, col: 'montoVes' | 'montoUsdMgmt'): boolean {
  let debe = new Decimal(0);
  let haber = new Decimal(0);
  for (const l of lineas) {
    const m = new Decimal(String(l[col]));
    if (l.dc === 'D') debe = debe.plus(m);
    else haber = haber.plus(m);
  }
  return debe.equals(haber);
}
