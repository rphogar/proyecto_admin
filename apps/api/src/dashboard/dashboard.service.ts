import { Injectable } from '@nestjs/common';
import { estadoDeResultados } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal, ventanasVentas, type VentanaFechas } from '@contave/shared';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  ceroDoble,
  diferenciaDias,
  dobleMonto,
  dos,
  type MontoDoble,
  periodoPrevio,
  periodoSiguiente,
  sumaVentas,
  sumarDias,
  variacion,
} from './dashboard-comun';
import { movimientosPorCuenta } from '../contabilidad/agregacion-saldos';
import { cargarPlan } from '../contabilidad/contabilidad-comun';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, documentLines, documents, exchangeRates, items, journalEntries, journalLines, parties, purchases, taxReturns } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { requireUuid } from '../maestros/validacion';
import { TasasService } from '../tasas/tasas.service';
import { withTenant } from '../tenant/with-tenant';
import { PosicionService } from '../tesoreria/posicion.service';

/**
 * Dashboard del dueño (P14, docs/06 M0, docs/01 §2). Una sola lectura que arma TODOS los widgets de
 * la vista móvil-primero, con la regla de oro de la pantalla: **nada cacheado que pueda descuadrar**
 * — cada cifra se deriva en vivo del ledger (saldos por partida, regla 8) o de las tablas fuente
 * (documentos/compras). Los importes salen en doble base VES/USD y la UI elige la moneda de vista
 * (USD por defecto, regla del dueño). El servicio no calcula impuestos: solo agrega lo ya registrado.
 */

// Tipos de documento de venta y estados que cuentan como emitidos.
const TIPOS_VENTA = ['FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO'] as const;
const ESTADOS_EMITIDO = ['ISSUED', 'APPLIED'] as const;
// Cuentas de cartera (deudoras) y de proveedores (acreedora) del plan base (docs/03 §2).
const CUENTAS_CXC = ['1.2.01', '1.2.02'] as const;
const PREFIJO_CXP = '2.1%';
// Día del mes siguiente en que vence la declaración de IVA del contribuyente ordinario.
// TODO-TRIBUTARISTA: los Sujetos Pasivos Especiales (SPE) declaran según el calendario SENIAT por
// dígito terminal del RIF; aquí se usa la regla ordinaria del Reglamento (primeros 15 días continuos).
const DIA_VENCIMIENTO_IVA = 15;

export interface VentasComparativo {
  readonly actual: MontoDoble;
  readonly anterior: MontoDoble;
  /** Variación % sobre la base gerencial (USD); null si el período anterior fue 0. */
  readonly variacionPct: string | null;
}

export interface DeudorDashboard {
  readonly partyId: string;
  readonly nombre: string;
  readonly rif: string;
  readonly telefono: string | null;
  readonly saldoVes: string;
  readonly saldoUsd: string;
  /** Días vencidos de la factura más antigua sin saldar (≤ 0 = al día). */
  readonly diasVencido: number;
}

export interface ProveedorPorPagar {
  readonly partyId: string;
  readonly nombre: string;
  readonly rif: string;
  readonly saldoVes: string;
  readonly saldoUsd: string;
  readonly fechaVence: string | null;
  /** Días restantes hasta el vencimiento más próximo (negativo = ya vencido). */
  readonly diasRestantes: number | null;
}

export interface ObligacionFiscal {
  readonly tipo: string;
  readonly periodo: string;
  readonly fechaLimite: string;
  readonly diasRestantes: number;
  readonly estado: 'PRESENTADA' | 'PENDIENTE';
}

export interface ProductoTop {
  readonly sku: string;
  readonly descripcion: string;
  readonly cantidad: string;
  readonly ventasVes: string;
  readonly ventasUsd: string;
}

export interface AlertaDashboard {
  readonly tipo: 'CXC_VENCIDA' | 'DECLARACION';
  readonly severidad: 'alta' | 'media';
  readonly mensaje: string;
}

export interface DashboardDto {
  readonly fecha: string;
  readonly caja: { readonly totalVes: string; readonly totalUsd: string; readonly metodos: { readonly codigo: string; readonly nombre: string; readonly saldoVes: string; readonly saldoUsd: string }[] };
  readonly ventas: { readonly dia: VentasComparativo; readonly semana: VentasComparativo; readonly mes: VentasComparativo };
  readonly utilidadMes: MontoDoble;
  readonly cxc: { readonly totalPorCobrar: MontoDoble; readonly totalVencido: MontoDoble; readonly topDeudores: DeudorDashboard[] };
  readonly cxp: { readonly totalPorPagar: MontoDoble; readonly proximas: ProveedorPorPagar[] };
  readonly tasaBcv: { readonly moneda: string; readonly rate: string | null; readonly rateDate: string | null; readonly variacionPct: string | null; readonly frescura: string } | null;
  readonly semaforoFiscal: { readonly obligaciones: ObligacionFiscal[] };
  readonly topProductos: ProductoTop[];
  readonly alertas: AlertaDashboard[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly posicion: PosicionService,
    private readonly tasas: TasasService,
  ) {}

  async resumen(companyIdRaw: unknown): Promise<DashboardDto> {
    const companyId = requireUuid(companyIdRaw, 'companyId');
    const hoy = fechaFiscal(new Date());
    const ventanas = ventanasVentas(hoy);
    const { anio, mes } = periodoFiscal(new Date());

    const [caja, restoDelLedger] = await Promise.all([
      this.posicion.consolidada(companyId),
      withTenant(this.database.db, async (tx) => {
        await asegurarEmpresaDelTenant(tx, companyId);
        const [ventas, utilidadMes, cxc, cxp, topProductos] = await Promise.all([
          this.ventas(tx, companyId, ventanas),
          this.utilidadMes(tx, companyId, anio, mes),
          this.cxc(tx, companyId, hoy),
          this.cxp(tx, companyId, hoy),
          this.topProductos(tx, companyId, ventanas.mes.actual),
        ]);
        return { ventas, utilidadMes, cxc, cxp, topProductos };
      }),
    ]);

    const [tasaBcv, semaforoFiscal] = await Promise.all([
      this.tasaBcv(hoy),
      this.semaforoFiscal(companyId, hoy, anio, mes),
    ]);

    const alertas = construirAlertas(restoDelLedger.cxc.topDeudores, semaforoFiscal.obligaciones);

    return {
      fecha: hoy,
      caja: {
        totalVes: caja.totalVes,
        totalUsd: caja.totalUsd,
        metodos: caja.metodos.map((m) => ({ codigo: m.codigo, nombre: m.nombre, saldoVes: m.saldoVes, saldoUsd: m.saldoUsd })),
      },
      ...restoDelLedger,
      tasaBcv,
      semaforoFiscal,
      alertas,
    };
  }

  // ── Ventas día/semana/mes vs período anterior (docs/06 M0) ────────────────────
  private async ventas(tx: DatabaseTx, companyId: string, v: ReturnType<typeof ventanasVentas>): Promise<DashboardDto['ventas']> {
    const filas = await tx
      .select({ tipo: documents.type, fecha: documents.issueFechaFiscal, ves: documents.totalVes, usd: documents.totalUsdMgmt })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          inArray(documents.status, [...ESTADOS_EMITIDO]),
          inArray(documents.type, [...TIPOS_VENTA]),
          gte(documents.issueFechaFiscal, v.mes.anterior.desde),
        ),
      );

    const comparativo = (c: { actual: VentanaFechas; anterior: VentanaFechas }): VentasComparativo => {
      const actual = sumaVentas(filas, c.actual);
      const anterior = sumaVentas(filas, c.anterior);
      return { actual: dobleMonto(actual), anterior: dobleMonto(anterior), variacionPct: variacion(actual.usd, anterior.usd) };
    };
    return { dia: comparativo(v.dia), semana: comparativo(v.semana), mes: comparativo(v.mes) };
  }

  // ── Utilidad del mes (USD gerencial), derivada del ledger ─────────────────────
  private async utilidadMes(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<MontoDoble> {
    const plan = await cargarPlan(tx, companyId);
    const movs = await movimientosPorCuenta(tx, companyId, { desde: { anio, mes }, hasta: { anio, mes } });
    const er = estadoDeResultados(movs, plan);
    return { ves: dos(er.utilidadVes.aCadenaDecimal()), usd: dos(er.utilidadUsd.aCadenaDecimal()) };
  }

  // ── CxC: saldo por cliente derivado del ledger + antigüedad de la más vieja ───
  private async cxc(tx: DatabaseTx, companyId: string, hoy: string): Promise<DashboardDto['cxc']> {
    const saldos = await saldosPorTercero(tx, companyId, { codigos: [...CUENTAS_CXC] });
    if (saldos.length === 0) {
      return { totalPorCobrar: ceroDoble(), totalVencido: ceroDoble(), topDeudores: [] };
    }
    const ids = saldos.map((s) => s.partyId);
    const terceros = await mapaTerceros(tx, companyId, ids);
    // Factura/ND a crédito más antigua sin distinguir aplicación (aproxima la antigüedad — regla 8
    // da el saldo exacto; el vencimiento sale de la condición de pago del documento más viejo).
    const masAntigua = await fechaDocumentoMasAntiguo(tx, companyId, ids, { tabla: 'documents' });

    let porCobrarVes = new Decimal(0);
    let porCobrarUsd = new Decimal(0);
    let vencidoVes = new Decimal(0);
    let vencidoUsd = new Decimal(0);
    const deudores: DeudorDashboard[] = [];
    for (const s of saldos) {
      const t = terceros.get(s.partyId);
      if (t === undefined) continue;
      porCobrarVes = porCobrarVes.plus(s.ves);
      porCobrarUsd = porCobrarUsd.plus(s.usd);
      const ref = masAntigua.get(s.partyId);
      const vence = ref === undefined ? null : sumarDias(ref, t.diasCredito);
      const diasVencido = vence === null ? 0 : diferenciaDias(hoy, vence);
      if (diasVencido > 0) {
        vencidoVes = vencidoVes.plus(s.ves);
        vencidoUsd = vencidoUsd.plus(s.usd);
      }
      deudores.push({ partyId: s.partyId, nombre: t.nombre, rif: t.rif, telefono: t.telefono, saldoVes: s.ves.toFixed(2), saldoUsd: s.usd.toFixed(2), diasVencido });
    }
    deudores.sort((a, b) => new Decimal(b.saldoUsd).minus(a.saldoUsd).toNumber());
    return {
      totalPorCobrar: { ves: porCobrarVes.toFixed(2), usd: porCobrarUsd.toFixed(2) },
      totalVencido: { ves: vencidoVes.toFixed(2), usd: vencidoUsd.toFixed(2) },
      topDeudores: deudores.slice(0, 5),
    };
  }

  // ── CxP: saldo por proveedor (ledger) + próximo vencimiento de la compra más vieja ─
  private async cxp(tx: DatabaseTx, companyId: string, hoy: string): Promise<DashboardDto['cxp']> {
    const saldos = await saldosPorTercero(tx, companyId, { prefijo: PREFIJO_CXP });
    if (saldos.length === 0) {
      return { totalPorPagar: ceroDoble(), proximas: [] };
    }
    const ids = saldos.map((s) => s.partyId);
    const terceros = await mapaTerceros(tx, companyId, ids);
    const masAntigua = await fechaDocumentoMasAntiguo(tx, companyId, ids, { tabla: 'purchases' });

    let porPagarVes = new Decimal(0);
    let porPagarUsd = new Decimal(0);
    const proximas: ProveedorPorPagar[] = [];
    for (const s of saldos) {
      const t = terceros.get(s.partyId);
      if (t === undefined) continue;
      porPagarVes = porPagarVes.plus(s.ves);
      porPagarUsd = porPagarUsd.plus(s.usd);
      const ref = masAntigua.get(s.partyId);
      const fechaVence = ref === undefined ? null : sumarDias(ref, t.diasCredito);
      const diasRestantes = fechaVence === null ? null : diferenciaDias(fechaVence, hoy);
      proximas.push({ partyId: s.partyId, nombre: t.nombre, rif: t.rif, saldoVes: s.ves.toFixed(2), saldoUsd: s.usd.toFixed(2), fechaVence, diasRestantes });
    }
    // Más urgentes primero (vencimiento más próximo); los sin fecha al final.
    proximas.sort((a, b) => (a.diasRestantes ?? Infinity) - (b.diasRestantes ?? Infinity));
    return { totalPorPagar: { ves: porPagarVes.toFixed(2), usd: porPagarUsd.toFixed(2) }, proximas: proximas.slice(0, 5) };
  }

  // ── Tasa BCV del día + variación contra la publicación anterior ───────────────
  private async tasaBcv(hoy: string): Promise<DashboardDto['tasaBcv']> {
    const dia = await this.tasas.tasaDelDia('USD', hoy);
    const variacionPct = await withTenant(this.database.db, async (tx) => {
      if (dia.rate === null || dia.rateDate === null) return null;
      const [previa] = await tx
        .select({ rate: exchangeRates.rate })
        .from(exchangeRates)
        .where(and(eq(exchangeRates.currency, 'USD'), lte(exchangeRates.rateDate, dia.rateDate), sql`${exchangeRates.rateDate} <> ${dia.rateDate}`))
        .orderBy(desc(exchangeRates.rateDate), desc(exchangeRates.capturedAt))
        .limit(1);
      return previa === undefined ? null : variacion(new Decimal(dia.rate), new Decimal(previa.rate));
    });
    return { moneda: dia.moneda, rate: dia.rate, rateDate: dia.rateDate, variacionPct, frescura: dia.frescura };
  }

  // ── Semáforo fiscal: próximas obligaciones de IVA (ordinario) ─────────────────
  private async semaforoFiscal(companyId: string, hoy: string, anio: number, mes: number): Promise<DashboardDto['semaforoFiscal']> {
    return withTenant(this.database.db, async (tx) => {
      // Períodos cuya declaración de IVA puede estar pendiente: el mes en curso vence el mes que
      // viene; mostramos también el período anterior por si aún no se presentó.
      const periodos = [periodoPrevio(anio, mes), { anio, mes }];
      const presentadas = await tx
        .select({ anio: taxReturns.periodoAnio, mes: taxReturns.periodoMes, status: taxReturns.status })
        .from(taxReturns)
        .where(and(eq(taxReturns.companyId, companyId), eq(taxReturns.tipo, 'IVA')));
      const presentada = new Set(presentadas.filter((p) => p.status === 'PRESENTADA').map((p) => `${p.anio}-${p.mes}`));

      const obligaciones: ObligacionFiscal[] = periodos.map((p) => {
        const venceMes = periodoSiguiente(p.anio, p.mes);
        const fechaLimite = `${venceMes.anio}-${String(venceMes.mes).padStart(2, '0')}-${String(DIA_VENCIMIENTO_IVA).padStart(2, '0')}`;
        const estado = presentada.has(`${p.anio}-${p.mes}`) ? 'PRESENTADA' : 'PENDIENTE';
        return { tipo: 'IVA', periodo: `${p.anio}-${String(p.mes).padStart(2, '0')}`, fechaLimite, diasRestantes: diferenciaDias(fechaLimite, hoy), estado };
      });
      return { obligaciones };
    });
  }

  // ── Top productos del mes por ventas en USD ───────────────────────────────────
  private async topProductos(tx: DatabaseTx, companyId: string, ventana: VentanaFechas): Promise<ProductoTop[]> {
    // Signo: NC resta; factura/ND suma (las ventas netas del período).
    const signo = sql<number>`case when ${documents.type} = 'NOTA_CREDITO' then -1 else 1 end`;
    const filas = await tx
      .select({
        sku: items.sku,
        descripcion: items.descripcion,
        cantidad: sql<string>`coalesce(sum(${documentLines.cantidad} * ${signo}), 0)`,
        ventasVes: sql<string>`coalesce(sum(${documentLines.baseVes} * ${signo}), 0)`,
        ventasUsd: sql<string>`coalesce(sum(${documentLines.baseUsdMgmt} * ${signo}), 0)`,
      })
      .from(documentLines)
      .innerJoin(documents, eq(documentLines.documentId, documents.id))
      .innerJoin(items, eq(documentLines.itemId, items.id))
      .where(
        and(
          eq(documents.companyId, companyId),
          inArray(documents.status, [...ESTADOS_EMITIDO]),
          inArray(documents.type, [...TIPOS_VENTA]),
          gte(documents.issueFechaFiscal, ventana.desde),
          lte(documents.issueFechaFiscal, ventana.hasta),
        ),
      )
      .groupBy(items.id, items.sku, items.descripcion)
      .orderBy(desc(sql`coalesce(sum(${documentLines.baseUsdMgmt} * ${signo}), 0)`))
      .limit(5);
    return filas.map((f) => ({ sku: f.sku, descripcion: f.descripcion, cantidad: dos(f.cantidad, 4), ventasVes: dos(f.ventasVes), ventasUsd: dos(f.ventasUsd) }));
  }
}

// ── Helpers de agregación derivada del ledger ───────────────────────────────────

interface SaldoTercero {
  partyId: string;
  ves: Decimal;
  usd: Decimal;
}

/** Saldo por tercero de un grupo de cuentas, en valor absoluto (deudor para CxC, acreedor para CxP). */
async function saldosPorTercero(
  tx: DatabaseTx,
  companyId: string,
  cuentas: { codigos?: string[]; prefijo?: string },
): Promise<SaldoTercero[]> {
  const filtroCuenta = cuentas.prefijo !== undefined ? sql`${accounts.codigo} like ${cuentas.prefijo}` : inArray(accounts.codigo, cuentas.codigos ?? []);
  const filas = await tx
    .select({
      partyId: journalLines.partyId,
      // Saldo neto firmado (D − C); CxC es deudora (+), CxP acreedora (−). Se normaliza a positivo abajo.
      ves: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'D' then ${journalLines.montoVes} else -${journalLines.montoVes} end), 0)`,
      usd: sql<string>`coalesce(sum(case when ${journalLines.dc} = 'D' then ${journalLines.montoUsdMgmt} else -${journalLines.montoUsdMgmt} end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.companyId, companyId), eq(journalEntries.estado, 'POSTED'), isNotNull(journalLines.partyId), filtroCuenta))
    .groupBy(journalLines.partyId);

  const esCxp = cuentas.prefijo !== undefined;
  return filas
    .filter((f): f is { partyId: string; ves: string; usd: string } => f.partyId !== null)
    .map((f) => ({ partyId: f.partyId, ves: new Decimal(f.ves).times(esCxp ? -1 : 1), usd: new Decimal(f.usd).times(esCxp ? -1 : 1) }))
    .filter((s) => s.ves.gt(0) || s.usd.gt(0)); // solo saldos abiertos a favor/cargo.
}

interface TerceroInfo {
  nombre: string;
  rif: string;
  telefono: string | null;
  diasCredito: number;
}

async function mapaTerceros(tx: DatabaseTx, companyId: string, ids: string[]): Promise<Map<string, TerceroInfo>> {
  if (ids.length === 0) return new Map();
  const filas = await tx
    .select({ id: parties.id, nombre: parties.razonSocial, rif: parties.rif, telefono: parties.telefono, diasCredito: parties.diasCredito })
    .from(parties)
    .where(and(eq(parties.companyId, companyId), inArray(parties.id, ids)));
  return new Map(filas.map((f) => [f.id, { nombre: f.nombre, rif: f.rif, telefono: f.telefono, diasCredito: f.diasCredito }]));
}

/** Fecha fiscal del documento (venta o compra) más antiguo por tercero, para estimar la antigüedad. */
async function fechaDocumentoMasAntiguo(
  tx: DatabaseTx,
  companyId: string,
  ids: string[],
  opciones: { tabla: 'documents' | 'purchases' },
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  if (opciones.tabla === 'documents') {
    const filas = await tx
      .select({ partyId: documents.partyId, fecha: sql<string>`min(${documents.issueFechaFiscal})` })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          inArray(documents.status, [...ESTADOS_EMITIDO]),
          inArray(documents.type, ['FACTURA', 'NOTA_DEBITO']),
          eq(documents.paymentCondition, 'CREDITO'),
          isNotNull(documents.partyId),
          inArray(documents.partyId, ids),
        ),
      )
      .groupBy(documents.partyId);
    return new Map(filas.filter((f) => f.partyId !== null).map((f) => [f.partyId as string, f.fecha]));
  }
  const filas = await tx
    .select({ partyId: purchases.partyId, fecha: sql<string>`min(${purchases.fechaFiscal})` })
    .from(purchases)
    .where(and(eq(purchases.companyId, companyId), eq(purchases.status, 'REGISTERED'), inArray(purchases.partyId, ids)))
    .groupBy(purchases.partyId);
  return new Map(filas.map((f) => [f.partyId, f.fecha]));
}

// ── Alertas ─────────────────────────────────────────────────────────────────────

function construirAlertas(deudores: DeudorDashboard[], obligaciones: ObligacionFiscal[]): AlertaDashboard[] {
  const alertas: AlertaDashboard[] = [];
  for (const d of deudores) {
    if (d.diasVencido > 0) {
      alertas.push({ tipo: 'CXC_VENCIDA', severidad: d.diasVencido >= 30 ? 'alta' : 'media', mensaje: `${d.nombre} tiene $${d.saldoUsd} vencidos hace ${d.diasVencido} días` });
    }
  }
  for (const o of obligaciones) {
    if (o.estado === 'PENDIENTE' && o.diasRestantes <= 5) {
      const cuando = o.diasRestantes < 0 ? `vencida hace ${-o.diasRestantes} días` : o.diasRestantes === 0 ? 'vence hoy' : `vence en ${o.diasRestantes} días`;
      alertas.push({ tipo: 'DECLARACION', severidad: o.diasRestantes <= 0 ? 'alta' : 'media', mensaje: `Declaración ${o.tipo} ${o.periodo} ${cuando}` });
    }
  }
  return alertas;
}
