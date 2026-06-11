import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { items } from '../db/schema';
import { CrudMaestroService } from './crud-maestro';
import {
  asRecord,
  optionalBoolean,
  requireEnum,
  requireString,
  requireUuid,
} from './validacion';

const TIPOS = ['producto', 'servicio'] as const;
const ALICUOTAS = ['GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'] as const;

type FilaItem = typeof items.$inferSelect;

interface ValoresItem {
  sku: string;
  descripcion: string;
  tipo: (typeof TIPOS)[number];
  alicuotaIva: (typeof ALICUOTAS)[number];
  unidad: string;
  controlLote: boolean;
  controlSerial: boolean;
  activo: boolean;
}

function parseCrear(body: unknown): { companyId: string; valores: ValoresItem } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    valores: {
      sku: requireString(b.sku, 'sku', 60),
      descripcion: requireString(b.descripcion, 'descripcion'),
      tipo: requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toLowerCase()),
      alicuotaIva: requireEnum(b.alicuotaIva, 'alicuotaIva', ALICUOTAS, (s) => s.toUpperCase()),
      unidad: requireString(b.unidad ?? 'UND', 'unidad', 20),
      controlLote: optionalBoolean(b.controlLote, false),
      controlSerial: optionalBoolean(b.controlSerial, false),
      activo: optionalBoolean(b.activo, true),
    },
  };
}

function parseActualizar(body: unknown): Partial<ValoresItem> {
  const b = asRecord(body);
  const out: Partial<ValoresItem> = {};
  if ('descripcion' in b) out.descripcion = requireString(b.descripcion, 'descripcion');
  if ('tipo' in b) out.tipo = requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toLowerCase());
  if ('alicuotaIva' in b)
    out.alicuotaIva = requireEnum(b.alicuotaIva, 'alicuotaIva', ALICUOTAS, (s) => s.toUpperCase());
  if ('unidad' in b) out.unidad = requireString(b.unidad, 'unidad', 20);
  if ('controlLote' in b) out.controlLote = optionalBoolean(b.controlLote, false);
  if ('controlSerial' in b) out.controlSerial = optionalBoolean(b.controlSerial, false);
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  // El `sku` es la clave de negocio: no se mueve tras el alta (la unicidad es (company, sku)).
  return out;
}

/** Maestro de ítems (productos/servicios) con categoría de alícuota (docs/05 §3.2). */
@Injectable()
export class ItemsService extends CrudMaestroService<FilaItem, ValoresItem> {
  constructor(database: DatabaseService, audit: AuditService) {
    super(database, audit, {
      tabla: items,
      entidad: 'items',
      accion: 'item',
      idCol: items.id,
      companyCol: items.companyId,
      ordenCol: items.sku,
      parseCrear,
      parseActualizar,
    });
  }
}
