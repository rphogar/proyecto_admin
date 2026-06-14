import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal, fechaFiscal } from '@contave/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import {
  ajusteLineas,
  ajustesInventario,
  conteoLineas,
  conteosFisicos,
  stockMoves,
} from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarAlmacen, cargarItem, exigirProducto } from './inventario-comun';
import { existenciaAlmacen } from './kardex-core';

export type Conteo = typeof conteosFisicos.$inferSelect;
export type ConteoLinea = typeof conteoLineas.$inferSelect;
export interface ConteoConLineas {
  conteo: Conteo;
  lineas: ConteoLinea[];
}

/**
 * Conteos físicos (P12, doc 06 M5). Al **abrir** se congela la cantidad del sistema por ítem en el
 * almacén; el operador captura lo contado (lector) y al **cerrar** las diferencias (`contada −
 * sistema`) generan un `ajustes_inventario` (tipo CONTEO) en estado PENDIENTE que pasa por la
 * aprobación normal (caso 40). El conteo CERRADO es inmutable.
 */
@Injectable()
export class ConteosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Abre un conteo congelando la cantidad del sistema por ítem (los indicados, o todos los del almacén). */
  async abrir(body: unknown): Promise<ConteoConLineas> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const warehouseId = requireUuid(b.warehouseId, 'warehouseId');
    const descripcion = optionalString(b.descripcion, 'descripcion', 500);
    const fecha = parseFecha(b.fecha);
    const itemIds = Array.isArray(b.itemIds)
      ? b.itemIds.map((v, i) => requireUuid(v, `itemIds[${i}]`))
      : null;

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);
      await cargarAlmacen(tx, companyId, warehouseId);

      const objetivos = itemIds ?? (await itemsDelAlmacen(tx, companyId, warehouseId));
      if (objetivos.length === 0) {
        throw new BadRequestException(
          'No hay ítems para contar en el almacén (indique itemIds o cargue existencias)',
        );
      }

      const conteoId = randomUUID();
      const [conteo] = await tx
        .insert(conteosFisicos)
        .values({
          id: conteoId,
          tenantId: ctx.tenantId,
          companyId,
          warehouseId,
          estado: 'ABIERTO',
          descripcion,
          fecha,
          fechaFiscal: fechaFiscal(fecha),
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (conteo === undefined) throw new Error('No se pudo abrir el conteo');

      const lineas: ConteoLinea[] = [];
      for (const itemId of objetivos) {
        exigirProducto(await cargarItem(tx, companyId, itemId));
        const sistema = await existenciaAlmacen(tx, companyId, itemId, warehouseId);
        const [linea] = await tx
          .insert(conteoLineas)
          .values({
            tenantId: ctx.tenantId,
            companyId,
            conteoId,
            itemId,
            cantidadSistema: sistema.toFixed(),
          })
          .returning();
        if (linea !== undefined) lineas.push(linea);
      }

      await this.audit.registrar(tx, {
        accion: 'inventario.conteo.abrir',
        entidad: 'conteos_fisicos',
        entidadId: conteoId,
        after: conteo,
      });
      return { conteo, lineas };
    });
  }

  /** Captura las cantidades contadas (por ítem) de un conteo ABIERTO. */
  async capturar(body: unknown): Promise<ConteoConLineas> {
    const b = asRecord(body);
    const conteoId = requireUuid(b.conteoId, 'conteoId');
    const capturas = Array.isArray(b.lineas) ? b.lineas : [];
    return withTenant(this.database.db, async (tx) => {
      const conteo = await cargarConteo(tx, conteoId);
      await asegurarEmpresaDelTenant(tx, conteo.companyId);
      if (conteo.estado !== 'ABIERTO')
        throw new BadRequestException(`El conteo no está ABIERTO (estado ${conteo.estado})`);

      for (const raw of capturas) {
        const l = asRecord(raw);
        const itemId = requireUuid(l.itemId, 'lineas[].itemId');
        const contada = requireDecimal(l.cantidadContada, 'lineas[].cantidadContada', true);
        await tx
          .update(conteoLineas)
          .set({
            cantidadContada: contada,
            diferencia: sql`${contada}::numeric - ${conteoLineas.cantidadSistema}`,
          })
          .where(and(eq(conteoLineas.conteoId, conteoId), eq(conteoLineas.itemId, itemId)));
      }
      const lineas = await tx
        .select()
        .from(conteoLineas)
        .where(eq(conteoLineas.conteoId, conteoId));
      return { conteo, lineas };
    });
  }

  /**
   * Cierra el conteo: convierte las diferencias en un ajuste PENDIENTE (tipo CONTEO) y marca CERRADO.
   * Devuelve el conteo y el `ajusteId` generado (null si no hubo diferencias).
   */
  async cerrar(body: unknown): Promise<{ conteo: Conteo; ajusteId: string | null }> {
    const b = asRecord(body);
    const conteoId = requireUuid(b.conteoId, 'conteoId');
    const motivo = optionalString(b.motivo, 'motivo', 500) ?? 'Ajuste por conteo físico';
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const conteo = await cargarConteo(tx, conteoId);
      await asegurarEmpresaDelTenant(tx, conteo.companyId);
      if (conteo.estado !== 'ABIERTO')
        throw new BadRequestException(`El conteo no está ABIERTO (estado ${conteo.estado})`);

      const lineas = await tx
        .select()
        .from(conteoLineas)
        .where(eq(conteoLineas.conteoId, conteoId));
      const conDiferencia = lineas.filter(
        (l) => l.cantidadContada != null && !new Decimal(l.diferencia ?? '0').isZero(),
      );

      let ajusteId: string | null = null;
      if (conDiferencia.length > 0) {
        ajusteId = randomUUID();
        await tx.insert(ajustesInventario).values({
          id: ajusteId,
          tenantId: ctx.tenantId,
          companyId: conteo.companyId,
          tipo: 'CONTEO',
          motivo,
          deducible: false, // las diferencias de conteo se revisan; por defecto no deducibles (caso 40)
          estado: 'PENDIENTE',
          conteoId,
          fecha: conteo.fecha,
          fechaFiscal: conteo.fechaFiscal,
          createdBy: ctx.userId ?? null,
        });
        await tx.insert(ajusteLineas).values(
          conDiferencia.map((l) => {
            const dif = new Decimal(l.diferencia ?? '0');
            return {
              tenantId: ctx.tenantId,
              companyId: conteo.companyId,
              ajusteId: ajusteId as string,
              itemId: l.itemId,
              warehouseId: conteo.warehouseId,
              direccion: dif.isPositive() ? 'ENTRADA' : 'SALIDA',
              cantidad: dif.abs().toFixed(),
            };
          }),
        );
      }

      const [actualizado] = await tx
        .update(conteosFisicos)
        .set({ estado: 'CERRADO', ajusteId, cerradoPor: ctx.userId ?? null, cerradoAt: new Date() })
        .where(eq(conteosFisicos.id, conteoId))
        .returning();
      if (actualizado === undefined) throw new Error('No se pudo cerrar el conteo');

      await this.audit.registrar(tx, {
        accion: 'inventario.conteo.cerrar',
        entidad: 'conteos_fisicos',
        entidadId: conteoId,
        before: conteo,
        after: actualizado,
      });
      return { conteo: actualizado, ajusteId };
    });
  }

  async listar(companyId: string): Promise<Conteo[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(conteosFisicos).where(eq(conteosFisicos.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cargarConteo(tx: DatabaseTx, conteoId: string): Promise<Conteo> {
  const [row] = await tx
    .select()
    .from(conteosFisicos)
    .where(eq(conteosFisicos.id, conteoId))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Conteo ${conteoId} no encontrado`);
  return row;
}

/** Ítems distintos con movimientos en el almacén (universo por defecto del conteo). */
async function itemsDelAlmacen(
  tx: DatabaseTx,
  companyId: string,
  warehouseId: string,
): Promise<string[]> {
  const filas = await tx
    .selectDistinct({ itemId: stockMoves.itemId })
    .from(stockMoves)
    .where(and(eq(stockMoves.companyId, companyId), eq(stockMoves.warehouseId, warehouseId)));
  return filas.map((f) => f.itemId);
}

function parseFecha(raw: unknown): Date {
  if (raw == null || String(raw).trim() === '') return new Date();
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`fecha inválida: ${String(raw)}`);
  return d;
}
