import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import type { DatabaseTx } from '../db/database.service';
import { branches, series } from '../db/schema';
import { CrudMaestroService } from './crud-maestro';
import {
  asRecord,
  optionalBoolean,
  optionalInt,
  optionalString,
  optionalUuid,
  requireEnum,
  requireUuid,
} from './validacion';

const DOC_TYPES = [
  'FACTURA',
  'NOTA_CREDITO',
  'NOTA_DEBITO',
  'GUIA_DESPACHO',
  'PEDIDO',
  'PRESUPUESTO',
  'COMPRA',
  'NOTA_ENTREGA',
  'COMPROBANTE_RETENCION_IVA',
  'COMPROBANTE_RETENCION_ISLR',
] as const;

type FilaSerie = typeof series.$inferSelect;

interface ValoresSerie {
  branchId: string | null;
  docType: (typeof DOC_TYPES)[number];
  prefijo: string;
  nextNumber: number;
  activo: boolean;
}

function parseCrear(body: unknown): { companyId: string; valores: ValoresSerie } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    valores: {
      branchId: optionalUuid(b.branchId, 'branchId'),
      docType: requireEnum(b.docType, 'docType', DOC_TYPES, (s) => s.toUpperCase()),
      prefijo: optionalString(b.prefijo, 'prefijo', 20) ?? '',
      // Permite arrancar el contador en un número distinto de 1 (migración desde otro sistema).
      nextNumber: optionalInt(b.nextNumber, 'nextNumber', 1, 1),
      activo: optionalBoolean(b.activo, true),
    },
  };
}

/**
 * En edición SOLO se permite activar/desactivar la serie. `next_number` lo gobierna la emisión
 * (contador transaccional, §4): exponerlo a un UPDATE arbitrario abriría huecos o duplicados y
 * violaría la regla 6 (numeración consecutiva sin huecos). `doc_type`/`prefijo`/`branch_id` son
 * identidad de la serie y tampoco se mueven una vez emitida.
 */
function parseActualizar(body: unknown): Partial<ValoresSerie> {
  const b = asRecord(body);
  const out: Partial<ValoresSerie> = {};
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  return out;
}

async function validarReferencias(
  tx: DatabaseTx,
  companyId: string,
  valores: Partial<ValoresSerie>,
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

/** Maestro de series de documentos con contador transaccional (docs/05 §3.4 y §4, regla 6). */
@Injectable()
export class SeriesService extends CrudMaestroService<FilaSerie, ValoresSerie> {
  constructor(database: DatabaseService, audit: AuditService) {
    super(database, audit, {
      tabla: series,
      entidad: 'series',
      accion: 'series',
      idCol: series.id,
      companyCol: series.companyId,
      ordenCol: series.docType,
      parseCrear,
      parseActualizar,
      validarReferencias,
    });
  }
}
