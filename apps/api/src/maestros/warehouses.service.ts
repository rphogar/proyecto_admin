import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import type { DatabaseTx } from '../db/database.service';
import { branches, warehouses } from '../db/schema';
import { CrudMaestroService } from './crud-maestro';
import {
  asRecord,
  optionalBoolean,
  optionalString,
  optionalUuid,
  requireString,
  requireUuid,
} from './validacion';

type FilaWarehouse = typeof warehouses.$inferSelect;

interface ValoresWarehouse {
  branchId: string | null;
  codigo: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
}

function parseCrear(body: unknown): { companyId: string; valores: ValoresWarehouse } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    valores: {
      branchId: optionalUuid(b.branchId, 'branchId'),
      codigo: requireString(b.codigo, 'codigo', 30),
      nombre: requireString(b.nombre, 'nombre'),
      direccion: optionalString(b.direccion, 'direccion'),
      activo: optionalBoolean(b.activo, true),
    },
  };
}

function parseActualizar(body: unknown): Partial<ValoresWarehouse> {
  const b = asRecord(body);
  const out: Partial<ValoresWarehouse> = {};
  if ('branchId' in b) out.branchId = optionalUuid(b.branchId, 'branchId');
  if ('nombre' in b) out.nombre = requireString(b.nombre, 'nombre');
  if ('direccion' in b) out.direccion = optionalString(b.direccion, 'direccion');
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  return out;
}

/** Verifica que la sucursal (si se indica) pertenezca a la misma empresa (integridad cross-company). */
async function validarReferencias(
  tx: DatabaseTx,
  companyId: string,
  valores: Partial<ValoresWarehouse>,
): Promise<void> {
  if (valores.branchId === undefined || valores.branchId === null) {
    return;
  }
  const [fila] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, valores.branchId), eq(branches.companyId, companyId)))
    .limit(1);
  if (fila === undefined) {
    throw new NotFoundException(`Sucursal ${valores.branchId} no encontrada en la empresa`);
  }
}

/** Maestro de almacenes (docs/05 §3.2, doc 06 M5). */
@Injectable()
export class WarehousesService extends CrudMaestroService<FilaWarehouse, ValoresWarehouse> {
  constructor(database: DatabaseService, audit: AuditService) {
    super(database, audit, {
      tabla: warehouses,
      entidad: 'warehouses',
      accion: 'warehouse',
      idCol: warehouses.id,
      companyCol: warehouses.companyId,
      ordenCol: warehouses.codigo,
      parseCrear,
      parseActualizar,
      validarReferencias,
    });
  }
}
