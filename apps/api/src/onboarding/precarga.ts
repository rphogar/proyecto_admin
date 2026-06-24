import { periodoFiscal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { seedPlanDeCuentas } from '../ledger/seed-plan-cuentas';
import {
  accounts,
  paymentMethods,
  periods,
  postingTemplateLines,
  postingTemplateVersions,
  postingTemplates,
  series,
  warehouses,
} from '../db/schema';
import type { PerfilInferido } from './perfil';
import { PLANTILLAS_BASE } from './plantillas-base';

/** Almacén por defecto que se crea con la empresa (el inventario de apertura cuelga de él). */
export const ALMACEN_PRINCIPAL = 'PRINCIPAL';

/** Métodos de pago por defecto mapeados a su cuenta del plan base (docs/05 §3.6). */
const METODOS_PAGO_DEFECTO: ReadonlyArray<{
  codigo: string;
  nombre: string;
  moneda: 'VES' | 'USD';
  cuenta: string;
  /** Causa IGTF solo si la empresa es agente de percepción (SPE). */
  igtfSiPercibe?: boolean;
}> = [
  { codigo: 'EFECTIVO_BS', nombre: 'Efectivo Bs', moneda: 'VES', cuenta: '1.1.01' },
  { codigo: 'EFECTIVO_USD', nombre: 'Efectivo USD', moneda: 'USD', cuenta: '1.1.02', igtfSiPercibe: true },
  { codigo: 'PAGO_MOVIL', nombre: 'Pago móvil', moneda: 'VES', cuenta: '1.1.03' },
  { codigo: 'TRANSFERENCIA', nombre: 'Transferencia', moneda: 'VES', cuenta: '1.1.03' },
  { codigo: 'PUNTO_VENTA', nombre: 'Punto de venta', moneda: 'VES', cuenta: '1.1.03' },
  { codigo: 'ZELLE', nombre: 'Zelle', moneda: 'USD', cuenta: '1.1.05', igtfSiPercibe: true },
  { codigo: 'USDT', nombre: 'USDT', moneda: 'USD', cuenta: '1.1.06', igtfSiPercibe: true },
];

/** Series de documentos por defecto (las de retención solo si la empresa es agente). */
const SERIES_DEFECTO = ['FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'GUIA_DESPACHO'] as const;

export interface ResultadoPrecarga {
  readonly cuentas: number;
  readonly almacenes: number;
  readonly metodosPago: number;
  readonly series: number;
  readonly plantillas: number;
  readonly periodos: number;
}

/**
 * Precarga TODO lo que una empresa necesita para operar (P30): plan de cuentas, almacén principal,
 * métodos de pago↔cuenta, series de documentos, plantillas de contabilización base y el período
 * abierto del mes en curso. Idempotente (se puede repetir el asistente sin duplicar). Corre DENTRO de
 * `withTenant` (RLS) y de la misma transacción que el alta de la empresa.
 */
export async function precargarEmpresa(
  tx: DatabaseTx,
  ctx: { tenantId: string; userId?: string | null },
  companyId: string,
  perfil: PerfilInferido,
): Promise<ResultadoPrecarga> {
  // 1. Plan de cuentas (idempotente por ON CONFLICT en seedPlanDeCuentas).
  const cuentasInsertadas = await seedPlanDeCuentas(tx, { tenantId: ctx.tenantId, companyId });

  // Mapa código→id ya sembrado, para resolver las cuentas de los métodos de pago.
  const filasCuentas = await tx
    .select({ id: accounts.id, codigo: accounts.codigo })
    .from(accounts)
    .where(eq(accounts.companyId, companyId));
  const cuentaPorCodigo = new Map(filasCuentas.map((f) => [f.codigo, f.id]));

  // 2. Almacén principal.
  const almacenes = await tx
    .insert(warehouses)
    .values({ tenantId: ctx.tenantId, companyId, codigo: ALMACEN_PRINCIPAL, nombre: 'Almacén principal' })
    .onConflictDoNothing({ target: [warehouses.companyId, warehouses.codigo] })
    .returning({ id: warehouses.id });

  // 3. Métodos de pago ↔ cuenta. IGTF según el perfil (percibe IGTF → divisas/cripto lo causan).
  const metodosValores = METODOS_PAGO_DEFECTO.flatMap((m) => {
    const cuentaId = cuentaPorCodigo.get(m.cuenta);
    if (cuentaId === undefined) return [];
    return [
      {
        tenantId: ctx.tenantId,
        companyId,
        codigo: m.codigo,
        nombre: m.nombre,
        moneda: m.moneda,
        cuentaId,
        causaIgtf: (m.igtfSiPercibe ?? false) && perfil.percibeIgtf,
      },
    ];
  });
  const metodos = await tx
    .insert(paymentMethods)
    .values(metodosValores)
    .onConflictDoNothing({ target: [paymentMethods.companyId, paymentMethods.codigo] })
    .returning({ id: paymentMethods.id });

  // 4. Series por defecto + las de retención si es agente. La unicidad de series es un índice con
  // expresión (no targeteable por ON CONFLICT): se insertan solo las que faltan.
  const tiposSerie = [...SERIES_DEFECTO, ...perfil.seriesRetencion];
  const existentes = await tx
    .select({ docType: series.docType })
    .from(series)
    .where(eq(series.companyId, companyId));
  const yaHay = new Set(existentes.map((e) => e.docType));
  const seriesFaltantes = tiposSerie
    .filter((t) => !yaHay.has(t))
    .map((docType) => ({ tenantId: ctx.tenantId, companyId, docType, prefijo: '', nextNumber: 1 }));
  let seriesInsertadas = 0;
  if (seriesFaltantes.length > 0) {
    const ins = await tx.insert(series).values(seriesFaltantes).returning({ id: series.id });
    seriesInsertadas = ins.length;
  }

  // 5. Plantillas de contabilización base (versión 1 vigente). Idempotente por (company, codigo).
  const templatesExistentes = await tx
    .select({ codigo: postingTemplates.codigo })
    .from(postingTemplates)
    .where(eq(postingTemplates.companyId, companyId));
  const codigosTemplate = new Set(templatesExistentes.map((t) => t.codigo));
  let plantillasInsertadas = 0;
  for (const plantilla of PLANTILLAS_BASE) {
    if (codigosTemplate.has(plantilla.codigo)) continue;
    const [template] = await tx
      .insert(postingTemplates)
      .values({
        tenantId: ctx.tenantId,
        companyId,
        codigo: plantilla.codigo,
        nombre: plantilla.nombre,
        operacionTipo: plantilla.operacionTipo,
        versionActual: 1,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: postingTemplates.id });
    if (template === undefined) continue;
    const [version] = await tx
      .insert(postingTemplateVersions)
      .values({
        tenantId: ctx.tenantId,
        companyId,
        templateId: template.id,
        version: 1,
        estado: 'VIGENTE',
        descripcionAsiento: plantilla.descripcionAsiento,
        createdBy: ctx.userId ?? null,
      })
      .returning({ id: postingTemplateVersions.id });
    if (version === undefined) continue;
    await tx.insert(postingTemplateLines).values(
      plantilla.lineas.map((l, i) => ({
        tenantId: ctx.tenantId,
        companyId,
        versionId: version.id,
        lineaNo: i + 1,
        cuentaCodigo: l.cuentaCodigo,
        dc: l.dc,
        magnitud: l.magnitud,
        signo: l.signo ?? 'POSITIVO',
        usaParty: l.usaParty ?? false,
      })),
    );
    plantillasInsertadas += 1;
  }

  // 6. Período abierto del mes fiscal en curso (Caracas), para poder operar de inmediato.
  const { anio, mes } = periodoFiscal(new Date());
  const periodosInsertados = await asegurarPeriodoAbierto(tx, ctx.tenantId, companyId, anio, mes);

  return {
    cuentas: cuentasInsertadas,
    almacenes: almacenes.length,
    metodosPago: metodos.length,
    series: seriesInsertadas,
    plantillas: plantillasInsertadas,
    periodos: periodosInsertados,
  };
}

/** Crea el período OPEN `anio-mes` si no existe. Devuelve 1 si lo creó, 0 si ya existía. */
export async function asegurarPeriodoAbierto(
  tx: DatabaseTx,
  tenantId: string,
  companyId: string,
  anio: number,
  mes: number,
): Promise<number> {
  const [existente] = await tx
    .select({ id: periods.id })
    .from(periods)
    .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
    .limit(1);
  if (existente !== undefined) return 0;
  const ins = await tx
    .insert(periods)
    .values({ tenantId, companyId, anio, mes, estado: 'OPEN' })
    .onConflictDoNothing({ target: [periods.companyId, periods.anio, periods.mes] })
    .returning({ id: periods.id });
  return ins.length;
}

/** Devuelve el id del almacén principal de la empresa (o null si no está sembrado). */
export async function almacenPrincipalId(tx: DatabaseTx, companyId: string): Promise<string | null> {
  const [fila] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, companyId), eq(warehouses.codigo, ALMACEN_PRINCIPAL)))
    .limit(1);
  return fila?.id ?? null;
}
