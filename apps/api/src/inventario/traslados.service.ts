import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { fechaFiscal } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { trasladoLineas, traslados } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalString, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarAlmacen, cargarItem, exigirProducto, hashIntegridad } from './inventario-comun';
import {
  existenciaAlmacen,
  insertarMovimiento,
  type NuevoMovimiento,
  snapshotMovimiento,
} from './kardex-core';

interface LineaTrasladoInput {
  itemId: string;
  cantidad: string;
}
interface DespacharInput {
  companyId: string;
  origenWarehouseId: string;
  destinoWarehouseId: string;
  fecha: Date;
  descripcion: string | null;
  lineas: LineaTrasladoInput[];
}

export type Traslado = typeof traslados.$inferSelect;
export type TrasladoLinea = typeof trasladoLineas.$inferSelect;
export interface TrasladoConLineas {
  traslado: Traslado;
  lineas: TrasladoLinea[];
}

/**
 * Traslados entre almacenes con estado EN_TRÁNSITO (P12, doc 06 M5; caso 41). Al **despachar** se
 * generan los `stock_moves` de SALIDA en el origen (al costo promedio vigente, congelado) y el
 * traslado queda EN_TRANSITO: la mercancía sale del origen pero aún no entra al destino → no está
 * disponible en NINGUNO de los dos. Al **recibir** se generan las ENTRADAS en el destino al MISMO
 * costo congelado. El traslado es neutro en costo (un solo 1.4 Inventarios) → no genera asiento.
 *
 * TODO-CONTABLE: una implementación con auxiliar por almacén usaría una cuenta puente "Mercancía en
 * tránsito"; aquí el valor en tránsito se rastrea en `traslado_lineas` (costo congelado × cantidad).
 */
@Injectable()
export class TrasladosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Despacha un traslado: SALIDA en el origen + estado EN_TRANSITO. */
  async despachar(body: unknown): Promise<TrasladoConLineas> {
    const e = parseDespachar(body);
    if (e.origenWarehouseId === e.destinoWarehouseId) {
      throw new BadRequestException('El almacén origen y destino deben ser distintos');
    }
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      await cargarAlmacen(tx, e.companyId, e.origenWarehouseId);
      await cargarAlmacen(tx, e.companyId, e.destinoWarehouseId);

      const trasladoId = randomUUID();
      const fFiscal = fechaFiscal(e.fecha);
      const lineasOut: TrasladoLinea[] = [];

      for (const l of e.lineas) {
        const item = await cargarItem(tx, e.companyId, l.itemId);
        exigirProducto(item);
        // No se puede despachar más de lo disponible en el almacén origen.
        const disp = await existenciaAlmacen(tx, e.companyId, l.itemId, e.origenWarehouseId);
        if (disp.lt(l.cantidad)) {
          throw new BadRequestException(
            `Existencia insuficiente de ${item.sku} en el almacén origen (disponible ${disp.toFixed()}, traslado ${l.cantidad})`,
          );
        }
        const mov: NuevoMovimiento = {
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          itemId: l.itemId,
          warehouseId: e.origenWarehouseId,
          tipo: 'TRASLADO',
          direccion: 'SALIDA',
          cantidad: l.cantidad,
          sourceType: 'TRASLADO',
          sourceId: trasladoId,
          fecha: e.fecha,
          fechaFiscal: fFiscal,
          createdBy: ctx.userId ?? null,
        };
        const fila = await snapshotMovimiento(tx, mov);
        const salida = await insertarMovimiento(tx, mov, fila, null);
        const [linea] = await tx
          .insert(trasladoLineas)
          .values({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            trasladoId,
            itemId: l.itemId,
            cantidad: l.cantidad,
            // Congela el costo unitario despachado para mover el mismo valor al recibir.
            costoUnitVes: fila.costoUnitVes,
            costoUnitUsd: fila.costoUnitUsd,
            salidaMoveId: salida.id,
          })
          .returning();
        if (linea !== undefined) lineasOut.push(linea);
      }

      const hash = hashIntegridad({
        trasladoId,
        companyId: e.companyId,
        origen: e.origenWarehouseId,
        destino: e.destinoWarehouseId,
        lineas: e.lineas,
      });
      const [traslado] = await tx
        .insert(traslados)
        .values({
          id: trasladoId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          origenWarehouseId: e.origenWarehouseId,
          destinoWarehouseId: e.destinoWarehouseId,
          estado: 'EN_TRANSITO',
          fechaDespacho: e.fecha,
          fechaFiscal: fFiscal,
          descripcion: e.descripcion,
          hashIntegridad: hash,
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (traslado === undefined) throw new Error('No se pudo registrar el traslado');

      await this.audit.registrar(tx, {
        accion: 'inventario.traslado.despachar',
        entidad: 'traslados',
        entidadId: trasladoId,
        after: traslado,
      });
      return { traslado, lineas: lineasOut };
    });
  }

  /** Recibe un traslado EN_TRANSITO: ENTRADA en el destino al costo congelado + estado RECIBIDO. */
  async recibir(body: unknown): Promise<TrasladoConLineas> {
    const b = asRecord(body);
    const trasladoId = requireUuid(b.trasladoId, 'trasladoId');
    const fecha = parseFecha(b.fecha);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const traslado = await cargarTraslado(tx, trasladoId);
      await asegurarEmpresaDelTenant(tx, traslado.companyId);
      if (traslado.estado !== 'EN_TRANSITO') {
        throw new BadRequestException(
          `El traslado no está EN_TRANSITO (estado ${traslado.estado})`,
        );
      }
      const lineas = await tx
        .select()
        .from(trasladoLineas)
        .where(eq(trasladoLineas.trasladoId, trasladoId));
      const fFiscal = fechaFiscal(fecha);

      for (const l of lineas) {
        const mov: NuevoMovimiento = {
          tenantId: ctx.tenantId,
          companyId: traslado.companyId,
          itemId: l.itemId,
          warehouseId: traslado.destinoWarehouseId,
          tipo: 'TRASLADO',
          direccion: 'ENTRADA',
          cantidad: l.cantidad,
          // Mismo costo congelado al despachar → el traslado es neutro a nivel de ítem.
          costo: { costoUnitVes: l.costoUnitVes, costoUnitUsd: l.costoUnitUsd },
          sourceType: 'TRASLADO',
          sourceId: trasladoId,
          fecha,
          fechaFiscal: fFiscal,
          createdBy: ctx.userId ?? null,
        };
        const fila = await snapshotMovimiento(tx, mov);
        const entrada = await insertarMovimiento(tx, mov, fila, null);
        await tx
          .update(trasladoLineas)
          .set({ entradaMoveId: entrada.id })
          .where(eq(trasladoLineas.id, l.id));
      }

      const [actualizado] = await tx
        .update(traslados)
        .set({ estado: 'RECIBIDO', fechaRecepcion: fecha, recibidoPor: ctx.userId ?? null })
        .where(eq(traslados.id, trasladoId))
        .returning();
      if (actualizado === undefined) throw new Error('No se pudo recibir el traslado');

      const lineasFinal = await tx
        .select()
        .from(trasladoLineas)
        .where(eq(trasladoLineas.trasladoId, trasladoId));
      await this.audit.registrar(tx, {
        accion: 'inventario.traslado.recibir',
        entidad: 'traslados',
        entidadId: trasladoId,
        before: traslado,
        after: actualizado,
      });
      return { traslado: actualizado, lineas: lineasFinal };
    });
  }

  async listar(companyId: string): Promise<Traslado[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(traslados).where(eq(traslados.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cargarTraslado(tx: DatabaseTx, trasladoId: string): Promise<Traslado> {
  const [row] = await tx.select().from(traslados).where(eq(traslados.id, trasladoId)).limit(1);
  if (row === undefined) throw new NotFoundException(`Traslado ${trasladoId} no encontrado`);
  return row;
}

function parseDespachar(body: unknown): DespacharInput {
  const b = asRecord(body);
  const lineasRaw = b.lineas;
  if (!Array.isArray(lineasRaw) || lineasRaw.length === 0) {
    throw new BadRequestException('El traslado requiere al menos una línea');
  }
  const lineas = lineasRaw.map((raw, i): LineaTrasladoInput => {
    const l = asRecord(raw);
    return {
      itemId: requireUuid(l.itemId, `lineas[${i}].itemId`),
      cantidad: requireDecimal(l.cantidad, `lineas[${i}].cantidad`),
    };
  });
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    origenWarehouseId: requireUuid(b.origenWarehouseId, 'origenWarehouseId'),
    destinoWarehouseId: requireUuid(b.destinoWarehouseId, 'destinoWarehouseId'),
    fecha: parseFecha(b.fecha),
    descripcion: optionalString(b.descripcion, 'descripcion', 500),
    lineas,
  };
}

function parseFecha(raw: unknown): Date {
  if (raw == null || String(raw).trim() === '') return new Date();
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`fecha inválida: ${String(raw)}`);
  return d;
}
