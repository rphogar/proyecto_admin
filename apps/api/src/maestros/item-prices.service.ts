import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { items, itemPrices, priceLists } from '../db/schema';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { asRecord, requireDecimal, requireUuid } from './validacion';

type FilaItemPrice = typeof itemPrices.$inferSelect;

/** Fila de precio con datos del ítem para mostrar en la pantalla de la lista (doc 06 M5). */
export interface PrecioConItem {
  id: string;
  itemId: string;
  sku: string;
  descripcion: string;
  precio: string;
}

/**
 * Precios de ítems por lista (junction `item_prices`, docs/05 §3.2). No usa el CRUD genérico: la
 * operación natural es "fijar el precio de un ítem en una lista" (upsert por `(price_list_id,
 * item_id)`, regla 1 monto Decimal). Todo bajo `withTenant` (RLS) y auditado (regla 5).
 */
@Injectable()
export class ItemPricesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Precios de una lista, con sku/descripción del ítem para la grilla. */
  async listarDeLista(priceListId: string): Promise<PrecioConItem[]> {
    const id = requireUuid(priceListId, 'priceListId');
    return withTenant(this.database.db, (tx) =>
      tx
        .select({
          id: itemPrices.id,
          itemId: items.id,
          sku: items.sku,
          descripcion: items.descripcion,
          precio: itemPrices.precio,
        })
        .from(itemPrices)
        .innerJoin(items, eq(items.id, itemPrices.itemId))
        .where(eq(itemPrices.priceListId, id))
        .orderBy(items.sku),
    );
  }

  /**
   * Fija (inserta o actualiza) el precio de un ítem en una lista. Verifica que la lista y el ítem
   * sean de la misma empresa (integridad cross-company) antes de escribir.
   */
  async fijar(body: unknown): Promise<FilaItemPrice> {
    const b = asRecord(body);
    const priceListId = requireUuid(b.priceListId, 'priceListId');
    const itemId = requireUuid(b.itemId, 'itemId');
    const precio = requireDecimal(b.precio, 'precio', true);

    return withTenant(this.database.db, async (tx) => {
      const [lista] = await tx
        .select({ companyId: priceLists.companyId })
        .from(priceLists)
        .where(eq(priceLists.id, priceListId))
        .limit(1);
      if (lista === undefined) {
        throw new NotFoundException(`Lista de precios ${priceListId} no encontrada`);
      }
      const [item] = await tx
        .select({ companyId: items.companyId })
        .from(items)
        .where(eq(items.id, itemId))
        .limit(1);
      if (item === undefined) {
        throw new NotFoundException(`Ítem ${itemId} no encontrado`);
      }
      if (item.companyId !== lista.companyId) {
        throw new BadRequestException('El ítem y la lista de precios son de empresas distintas');
      }

      const ctx = requireTenantContext();
      const [existente] = await tx
        .select()
        .from(itemPrices)
        .where(and(eq(itemPrices.priceListId, priceListId), eq(itemPrices.itemId, itemId)))
        .limit(1);

      if (existente === undefined) {
        const [fila] = await tx
          .insert(itemPrices)
          .values({
            tenantId: ctx.tenantId,
            companyId: lista.companyId,
            priceListId,
            itemId,
            precio,
          })
          .returning();
        await this.audit.registrar(tx, {
          accion: 'item_price.fijar',
          entidad: 'item_prices',
          entidadId: (fila as FilaItemPrice).id,
          after: fila,
        });
        return fila as FilaItemPrice;
      }

      const [fila] = await tx
        .update(itemPrices)
        .set({ precio })
        .where(eq(itemPrices.id, existente.id))
        .returning();
      await this.audit.registrar(tx, {
        accion: 'item_price.fijar',
        entidad: 'item_prices',
        entidadId: existente.id,
        before: existente,
        after: fila,
      });
      return fila as FilaItemPrice;
    });
  }

  async eliminar(id: string): Promise<void> {
    const uid = requireUuid(id, 'id');
    await withTenant(this.database.db, async (tx) => {
      const [antes] = await tx.select().from(itemPrices).where(eq(itemPrices.id, uid)).limit(1);
      if (antes === undefined) {
        throw new NotFoundException(`Precio ${id} no encontrado`);
      }
      await tx.delete(itemPrices).where(eq(itemPrices.id, uid));
      await this.audit.registrar(tx, {
        accion: 'item_price.eliminar',
        entidad: 'item_prices',
        entidadId: uid,
        before: antes,
      });
    });
  }
}
