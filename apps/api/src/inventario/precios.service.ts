import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { itemPrices, items, priceLists } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalDecimal,
  optionalString,
  requireDecimal,
  requireEnum,
  requireUuid,
} from '../maestros/validacion';
import { withTenant } from '../tenant/with-tenant';
import {
  calcularPreciosMasivo,
  type ConfigPrecios,
  type ItemPrecioActual,
  type ModoPrecio,
  type RedondeoPsicologico,
  type ResultadoPrecios,
} from './calculo-precios';
import { costoItem } from './kardex-core';

const MODOS: readonly ModoPrecio[] = ['PORCENTAJE', 'MARGEN_COSTO', 'TASA'];
const REDONDEOS: readonly RedondeoPsicologico[] = ['NINGUNO', 'ENTERO', 'TERMINACION_99'];

interface PreciosInput {
  companyId: string;
  priceListId: string;
  config: ConfigPrecios;
}

/**
 * Actualización masiva de precios (P12, doc 06 M5: "Actualizar precios masivo … con vista previa").
 * `preview` calcula sin persistir; `aplicar` recalcula y persiste los `item_prices` de la lista. El
 * cálculo es puro ({@link calcularPreciosMasivo}); aquí solo resolvemos precios y costos de la lista.
 * Para `MARGEN_COSTO` el costo es el costo promedio del ítem expresado en la moneda de la lista.
 */
@Injectable()
export class PreciosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async preview(body: unknown): Promise<ResultadoPrecios> {
    const e = parse(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const { items: lista } = await cargarLista(tx, e.companyId, e.priceListId, e.config.modo);
      return calcularPreciosMasivo(lista, e.config);
    });
  }

  async aplicar(body: unknown): Promise<{ actualizados: number; resultado: ResultadoPrecios }> {
    const e = parse(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const { items: lista, priceMap } = await cargarLista(
        tx,
        e.companyId,
        e.priceListId,
        e.config.modo,
      );
      const resultado = calcularPreciosMasivo(lista, e.config);

      let actualizados = 0;
      for (const l of resultado.lineas) {
        if (l.sinDato) continue;
        const priceId = priceMap.get(l.itemId);
        if (priceId === undefined) continue;
        await tx
          .update(itemPrices)
          .set({ precio: l.precioNuevo })
          .where(eq(itemPrices.id, priceId));
        actualizados += 1;
      }

      await this.audit.registrar(tx, {
        accion: 'inventario.precios.aplicar',
        entidad: 'price_lists',
        entidadId: e.priceListId,
        after: { modo: e.config.modo, valor: e.config.valor, actualizados },
      });
      return { actualizados, resultado };
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ListaCargada {
  items: ItemPrecioActual[];
  priceMap: Map<string, string>; // itemId → itemPrices.id
}

async function cargarLista(
  tx: DatabaseTx,
  companyId: string,
  priceListId: string,
  modo: ModoPrecio,
): Promise<ListaCargada> {
  const [lista] = await tx
    .select()
    .from(priceLists)
    .where(and(eq(priceLists.id, priceListId), eq(priceLists.companyId, companyId)))
    .limit(1);
  if (lista === undefined)
    throw new NotFoundException(`Lista de precios ${priceListId} no encontrada`);

  const filas = await tx
    .select({
      priceId: itemPrices.id,
      itemId: itemPrices.itemId,
      precio: itemPrices.precio,
      descripcion: items.descripcion,
    })
    .from(itemPrices)
    .innerJoin(items, eq(itemPrices.itemId, items.id))
    .where(and(eq(itemPrices.priceListId, priceListId), eq(itemPrices.companyId, companyId)));

  const priceMap = new Map<string, string>();
  const result: ItemPrecioActual[] = [];
  for (const f of filas) {
    priceMap.set(f.itemId, f.priceId);
    // El costo solo se necesita (y se consulta) para MARGEN_COSTO; en la moneda de la lista.
    let costo: string | null = null;
    if (modo === 'MARGEN_COSTO') {
      const k = await costoItem(tx, companyId, f.itemId);
      costo =
        lista.moneda === 'VES'
          ? k.costoPromedioVes
          : lista.moneda === 'USD'
            ? k.costoPromedioUsd
            : null;
    }
    result.push({ itemId: f.itemId, descripcion: f.descripcion, precioActual: f.precio, costo });
  }
  return { items: result, priceMap };
}

function parse(body: unknown): PreciosInput {
  const b = asRecord(body);
  const modo = requireEnum(b.modo, 'modo', MODOS, (s) => s.toUpperCase()) as ModoPrecio;
  const redondeo = (optionalString(b.redondeo, 'redondeo', 20)?.toUpperCase() ??
    'NINGUNO') as RedondeoPsicologico;
  if (!REDONDEOS.includes(redondeo)) {
    throw new BadRequestException(`redondeo inválido: ${redondeo} (use ${REDONDEOS.join(', ')})`);
  }
  const config: ConfigPrecios = {
    modo,
    valor: requireDecimal(b.valor, 'valor', true),
    tasaActual:
      modo === 'TASA'
        ? requireDecimal(b.tasaActual, 'tasaActual')
        : optionalDecimal(b.tasaActual, 'tasaActual'),
    redondeo,
  };
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    priceListId: requireUuid(b.priceListId, 'priceListId'),
    config,
  };
}
