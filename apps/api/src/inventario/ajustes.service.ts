import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Asiento, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { ajusteLineas, ajustesInventario } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalBoolean,
  optionalString,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { armarAsientoAjuste, type LineaAjusteValuada } from './asientos-inventario';
import {
  cargarAlmacen,
  cargarCuentas,
  cargarItem,
  exigirProducto,
  hashIntegridad,
  requerirPeriodoAbierto,
} from './inventario-comun';
import {
  costoItem,
  insertarMovimiento,
  type NuevoMovimiento,
  snapshotMovimiento,
} from './kardex-core';

const TIPOS_AJUSTE = ['MERMA', 'ROBO', 'SOBRANTE', 'CONTEO', 'OTRO'] as const;

interface LineaAjusteInput {
  itemId: string;
  warehouseId: string;
  direccion: 'ENTRADA' | 'SALIDA';
  cantidad: string;
}

interface CrearAjusteInput {
  companyId: string;
  branchId: string | null;
  tipo: (typeof TIPOS_AJUSTE)[number];
  motivo: string;
  deducible: boolean;
  fecha: Date;
  conteoId: string | null;
  lineas: LineaAjusteInput[];
}

export type Ajuste = typeof ajustesInventario.$inferSelect;
export type AjusteLinea = typeof ajusteLineas.$inferSelect;
export interface AjusteConLineas {
  ajuste: Ajuste;
  lineas: AjusteLinea[];
}

/**
 * Ajustes de inventario con MOTIVO y APROBACIÓN (P12, doc 06 M5; caso 40). El ajuste nace PENDIENTE;
 * al aprobarlo (rol distinto al creador — separación de deberes, regla 13) se generan los `stock_moves`
 * y el asiento (inventario ⇄ gasto 6.3/6.8 según `deducible`, o ingreso 4.6 en sobrantes). Los moves se
 * enlazan al asiento por `source_id = ajuste.id`; la cabecera lleva el `journal_entry_id`.
 */
@Injectable()
export class AjustesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async crear(body: unknown): Promise<AjusteConLineas> {
    const e = parseCrear(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      for (const l of e.lineas) {
        exigirProducto(await cargarItem(tx, e.companyId, l.itemId));
        await cargarAlmacen(tx, e.companyId, l.warehouseId);
      }

      const ajusteId = randomUUID();
      const [ajuste] = await tx
        .insert(ajustesInventario)
        .values({
          id: ajusteId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          branchId: e.branchId,
          tipo: e.tipo,
          motivo: e.motivo,
          deducible: e.deducible,
          estado: 'PENDIENTE',
          conteoId: e.conteoId,
          fecha: e.fecha,
          fechaFiscal: fechaFiscal(e.fecha),
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (ajuste === undefined) throw new Error('No se pudo crear el ajuste');

      const lineas = await tx
        .insert(ajusteLineas)
        .values(
          e.lineas.map((l) => ({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            ajusteId,
            itemId: l.itemId,
            warehouseId: l.warehouseId,
            direccion: l.direccion,
            cantidad: l.cantidad,
          })),
        )
        .returning();

      await this.audit.registrar(tx, {
        accion: 'inventario.ajuste.crear',
        entidad: 'ajustes_inventario',
        entidadId: ajusteId,
        after: ajuste,
      });
      return { ajuste, lineas };
    });
  }

  /** Aprueba un ajuste PENDIENTE: genera movimientos + asiento y lo deja APROBADO (inmutable). */
  async aprobar(body: unknown): Promise<AjusteConLineas> {
    const b = asRecord(body);
    const ajusteId = requireUuid(b.ajusteId, 'ajusteId');
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const ajuste = await cargarAjuste(tx, ajusteId);
      await asegurarEmpresaDelTenant(tx, ajuste.companyId);
      if (ajuste.estado !== 'PENDIENTE') {
        throw new BadRequestException(`El ajuste no está PENDIENTE (estado ${ajuste.estado})`);
      }
      // Separación de deberes (regla 13): quien aprueba ≠ quien creó (cuando ambos se conocen).
      if (ctx.userId != null && ajuste.createdBy != null && ctx.userId === ajuste.createdBy) {
        throw new ForbiddenException(
          'El ajuste debe aprobarlo un usuario distinto al que lo creó (separación de deberes)',
        );
      }

      const lineas = await tx
        .select()
        .from(ajusteLineas)
        .where(eq(ajusteLineas.ajusteId, ajusteId));
      if (lineas.length === 0) throw new BadRequestException('El ajuste no tiene líneas');

      const { porCodigo } = await cargarCuentas(tx, ajuste.companyId);
      const { anio, mes } = periodoFiscal(ajuste.fecha);
      const periodId = await requerirPeriodoAbierto(tx, ajuste.companyId, anio, mes);
      const fFiscal = fechaFiscal(ajuste.fecha);

      // Costo promedio vigente por ítem (cacheado): valora las ENTRADAS (sobrantes) al costo de libros
      // de antes del ajuste, manteniendo el promedio (sobrante = revalorización de unidades halladas).
      const avgCache = new Map<string, { costoUnitVes: string; costoUnitUsd: string }>();
      const costoEntrada = async (
        itemId: string,
      ): Promise<{ costoUnitVes: string; costoUnitUsd: string }> => {
        const c = avgCache.get(itemId);
        if (c !== undefined) return c;
        const k = await costoItem(tx, ajuste.companyId, itemId);
        const v = { costoUnitVes: k.costoPromedioVes, costoUnitUsd: k.costoPromedioUsd };
        avgCache.set(itemId, v);
        return v;
      };

      // Inserta los movimientos secuencialmente (cada uno recalcula el promedio del ítem) y acumula
      // las líneas valoradas para el asiento.
      const valuadas: LineaAjusteValuada[] = [];
      const movInfo: { lineaId: string; moveId: string; ves: string; usd: string }[] = [];
      let totalVes = new Decimal(0);
      let totalUsd = new Decimal(0);

      for (const l of lineas) {
        const direccion = l.direccion as 'ENTRADA' | 'SALIDA';
        const mov: NuevoMovimiento = {
          tenantId: ctx.tenantId,
          companyId: ajuste.companyId,
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          tipo: 'AJUSTE',
          direccion,
          cantidad: l.cantidad,
          sourceType: 'AJUSTE',
          sourceId: ajusteId,
          fecha: ajuste.fecha,
          fechaFiscal: fFiscal,
          createdBy: ctx.userId ?? null,
          permitirNegativo: true, // la merma puede dejar el stock en 0; el conteo refleja la realidad
          ...(direccion === 'ENTRADA' ? { costo: await costoEntrada(l.itemId) } : {}),
        };
        const fila = await snapshotMovimiento(tx, mov);
        const row = await insertarMovimiento(tx, mov, fila, null);
        valuadas.push({ direccion, valorVes: fila.valorVes, valorUsd: fila.valorUsd });
        movInfo.push({ lineaId: l.id, moveId: row.id, ves: fila.valorVes, usd: fila.valorUsd });
        totalVes = totalVes.plus(fila.valorVes);
        totalUsd = totalUsd.plus(fila.valorUsd);
      }

      // Asiento del ajuste (gasto/ingreso ⇄ inventario).
      const entrada = armarAsientoAjuste({
        fecha: ajuste.fecha,
        descripcion: `Ajuste de inventario ${ajuste.tipo}: ${ajuste.motivo}`,
        lineas: valuadas,
        deducible: ajuste.deducible,
        companyId: ajuste.companyId,
        sourceId: ajusteId,
      });
      let entryId: string | null = null;
      if (entrada !== undefined) {
        const asiento = postear(Asiento.construir(entrada));
        entryId = await persistirAsiento(tx, asiento, {
          tenantId: ctx.tenantId,
          companyId: ajuste.companyId,
          periodId,
          createdBy: ctx.userId ?? null,
          cuentas: porCodigo,
        });
      }

      // Completa las líneas (costos resueltos + move) ANTES de marcar APROBADO (el trigger lo exige).
      for (const info of movInfo) {
        await tx
          .update(ajusteLineas)
          .set({ valorVes: info.ves, valorUsd: info.usd, stockMoveId: info.moveId })
          .where(eq(ajusteLineas.id, info.lineaId));
      }

      const hash = hashIntegridad({
        ajusteId,
        companyId: ajuste.companyId,
        entryId,
        totalVes: totalVes.toFixed(8),
      });
      const [actualizado] = await tx
        .update(ajustesInventario)
        .set({
          estado: 'APROBADO',
          journalEntryId: entryId,
          totalValorVes: totalVes.toFixed(8),
          totalValorUsd: totalUsd.toFixed(8),
          hashIntegridad: hash,
          aprobadoPor: ctx.userId ?? null,
          aprobadoAt: new Date(),
        })
        .where(eq(ajustesInventario.id, ajusteId))
        .returning();
      if (actualizado === undefined) throw new Error('No se pudo aprobar el ajuste');

      const lineasFinal = await tx
        .select()
        .from(ajusteLineas)
        .where(eq(ajusteLineas.ajusteId, ajusteId));
      await this.audit.registrar(tx, {
        accion: 'inventario.ajuste.aprobar',
        entidad: 'ajustes_inventario',
        entidadId: ajusteId,
        before: ajuste,
        after: actualizado,
      });
      return { ajuste: actualizado, lineas: lineasFinal };
    });
  }

  async rechazar(body: unknown): Promise<Ajuste> {
    const b = asRecord(body);
    const ajusteId = requireUuid(b.ajusteId, 'ajusteId');
    const motivo = optionalString(b.motivoRechazo, 'motivoRechazo', 500);
    return withTenant(this.database.db, async (tx) => {
      const ajuste = await cargarAjuste(tx, ajusteId);
      await asegurarEmpresaDelTenant(tx, ajuste.companyId);
      if (ajuste.estado !== 'PENDIENTE') {
        throw new BadRequestException(
          `Solo se puede rechazar un ajuste PENDIENTE (estado ${ajuste.estado})`,
        );
      }
      const [actualizado] = await tx
        .update(ajustesInventario)
        .set({
          estado: 'RECHAZADO',
          motivo: motivo != null ? `${ajuste.motivo} | RECHAZO: ${motivo}` : ajuste.motivo,
        })
        .where(eq(ajustesInventario.id, ajusteId))
        .returning();
      if (actualizado === undefined) throw new Error('No se pudo rechazar el ajuste');
      await this.audit.registrar(tx, {
        accion: 'inventario.ajuste.rechazar',
        entidad: 'ajustes_inventario',
        entidadId: ajusteId,
        before: ajuste,
        after: actualizado,
      });
      return actualizado;
    });
  }

  async listar(companyId: string): Promise<Ajuste[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(ajustesInventario).where(eq(ajustesInventario.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cargarAjuste(tx: DatabaseTx, ajusteId: string): Promise<Ajuste> {
  const [row] = await tx
    .select()
    .from(ajustesInventario)
    .where(eq(ajustesInventario.id, ajusteId))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Ajuste ${ajusteId} no encontrado`);
  return row;
}

function parseCrear(body: unknown): CrearAjusteInput {
  const b = asRecord(body);
  const lineasRaw = b.lineas;
  if (!Array.isArray(lineasRaw) || lineasRaw.length === 0) {
    throw new BadRequestException('El ajuste requiere al menos una línea');
  }
  const lineas = lineasRaw.map((raw, i): LineaAjusteInput => {
    const l = asRecord(raw);
    return {
      itemId: requireUuid(l.itemId, `lineas[${i}].itemId`),
      warehouseId: requireUuid(l.warehouseId, `lineas[${i}].warehouseId`),
      direccion: requireEnum(
        l.direccion,
        `lineas[${i}].direccion`,
        ['ENTRADA', 'SALIDA'] as const,
        (s) => s.toUpperCase(),
      ),
      cantidad: requireDecimal(l.cantidad, `lineas[${i}].cantidad`),
    };
  });
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    branchId: optionalUuid(b.branchId, 'branchId'),
    tipo: requireEnum(b.tipo ?? 'OTRO', 'tipo', TIPOS_AJUSTE, (s) => s.toUpperCase()),
    motivo: requireString(b.motivo, 'motivo', 500),
    deducible: optionalBoolean(b.deducible, false),
    fecha: parseFecha(b.fecha),
    conteoId: optionalUuid(b.conteoId, 'conteoId'),
    lineas,
  };
}

function parseFecha(raw: unknown): Date {
  if (raw == null || String(raw).trim() === '') return new Date();
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`fecha inválida: ${String(raw)}`);
  return d;
}
