import { Injectable } from '@nestjs/common';
import { Decimal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { itemPrices, items, priceLists } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { optionalUuid, requireDecimal, requireUuid } from '../maestros/validacion';
import { withTenant } from '../tenant/with-tenant';
import { detectarMargenNegativo, type ItemMargen, type ResultadoMargen } from './calculo-margen';
import { costoItem } from './kardex-core';

/**
 * Alerta de **margen negativo en USD** (P12, doc 06 M5: "precio < costo de reposición USD — error
 * común con inflación"). Resuelve el precio de venta de cada producto en USD (la lista convertida a
 * USD por la tasa BCV del día) y el costo promedio en USD (proxy del costo de reposición), y marca los
 * ítems que venden por debajo del costo. El cálculo es puro ({@link detectarMargenNegativo}).
 */
@Injectable()
export class AlertasService {
  constructor(private readonly database: DatabaseService) {}

  async margenNegativo(
    companyId: string,
    rateBcv: unknown,
    priceListId: unknown,
  ): Promise<ResultadoMargen> {
    const cid = requireUuid(companyId, 'companyId');
    const rate = new Decimal(requireDecimal(rateBcv, 'rateBcv'));
    const listId = optionalUuid(priceListId, 'priceListId');

    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      const lista = await resolverLista(tx, cid, listId);
      if (lista === null) return { filas: [], alertas: [] };

      const filas = await tx
        .select({
          itemId: itemPrices.itemId,
          precio: itemPrices.precio,
          sku: items.sku,
          descripcion: items.descripcion,
          tipo: items.tipo,
        })
        .from(itemPrices)
        .innerJoin(items, eq(itemPrices.itemId, items.id))
        .where(and(eq(itemPrices.priceListId, lista.id), eq(itemPrices.companyId, cid)));

      const entradas: ItemMargen[] = [];
      for (const f of filas) {
        if (f.tipo !== 'producto') continue; // los servicios no tienen costo de inventario
        const precioUsd = precioEnUsd(new Decimal(f.precio), lista.moneda, rate);
        if (precioUsd === null) continue; // moneda de lista no soportada para la conversión (p. ej. EUR)
        const k = await costoItem(tx, cid, f.itemId);
        entradas.push({
          itemId: f.itemId,
          sku: f.sku,
          descripcion: f.descripcion,
          precioUsd: precioUsd.toFixed(8),
          costoUsd: k.costoPromedioUsd,
        });
      }
      return detectarMargenNegativo(entradas);
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte un precio de la moneda de la lista a USD; null si la moneda no se puede convertir aquí. */
function precioEnUsd(precio: Decimal, moneda: string, rateBcv: Decimal): Decimal | null {
  if (moneda === 'USD') return precio;
  if (moneda === 'VES') return rateBcv.lte(0) ? null : precio.div(rateBcv);
  return null;
}

interface ListaRef {
  id: string;
  moneda: string;
}

async function resolverLista(
  tx: DatabaseTx,
  companyId: string,
  priceListId: string | null,
): Promise<ListaRef | null> {
  if (priceListId !== null) {
    const [l] = await tx
      .select({ id: priceLists.id, moneda: priceLists.moneda })
      .from(priceLists)
      .where(and(eq(priceLists.id, priceListId), eq(priceLists.companyId, companyId)))
      .limit(1);
    return l ?? null;
  }
  // Lista por defecto de la empresa; si no hay marcada, la primera.
  const [def] = await tx
    .select({ id: priceLists.id, moneda: priceLists.moneda })
    .from(priceLists)
    .where(and(eq(priceLists.companyId, companyId), eq(priceLists.esDefault, true)))
    .limit(1);
  if (def !== undefined) return def;
  const [first] = await tx
    .select({ id: priceLists.id, moneda: priceLists.moneda })
    .from(priceLists)
    .where(eq(priceLists.companyId, companyId))
    .limit(1);
  return first ?? null;
}
