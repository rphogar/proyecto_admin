import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { items, warehouses } from '../db/schema';

/**
 * Helpers compartidos por los servicios de inventario (P12). La resolución del plan de cuentas
 * (`cargarCuentas`), el período abierto (`requerirPeriodoAbierto`) y el `hashIntegridad` se reutilizan
 * de tesorería (P11) para no duplicar. Aquí van solo los loaders propios de inventario (ítem, almacén).
 */
export {
  cargarCuentas,
  requerirPeriodoAbierto,
  hashIntegridad,
} from '../tesoreria/tesoreria-comun';

export type Item = typeof items.$inferSelect;
export type Warehouse = typeof warehouses.$inferSelect;

/** Carga un ítem de la empresa (producto/servicio); lanza 404 si no existe. */
export async function cargarItem(tx: DatabaseTx, companyId: string, itemId: string): Promise<Item> {
  const [row] = await tx
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
    .limit(1);
  if (row === undefined) throw new NotFoundException(`Ítem ${itemId} no encontrado en la empresa`);
  return row;
}

/** Carga un almacén de la empresa; lanza 404 si no existe. */
export async function cargarAlmacen(
  tx: DatabaseTx,
  companyId: string,
  warehouseId: string,
): Promise<Warehouse> {
  const [row] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.id, warehouseId), eq(warehouses.companyId, companyId)))
    .limit(1);
  if (row === undefined)
    throw new NotFoundException(`Almacén ${warehouseId} no encontrado en la empresa`);
  return row;
}

/** Valida que un ítem sea de tipo `producto` (los servicios no llevan inventario). */
export function exigirProducto(item: Item): void {
  if (item.tipo !== 'producto') {
    throw new BadRequestException(
      `El ítem "${item.sku}" es de tipo "${item.tipo}": los servicios no llevan inventario`,
    );
  }
}
