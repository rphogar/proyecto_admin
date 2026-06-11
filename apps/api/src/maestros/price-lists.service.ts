import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { priceLists } from '../db/schema';
import { CrudMaestroService } from './crud-maestro';
import {
  asRecord,
  optionalBoolean,
  requireEnum,
  requireString,
  requireUuid,
} from './validacion';

const MONEDAS = ['VES', 'USD', 'EUR'] as const;

type FilaPriceList = typeof priceLists.$inferSelect;

interface ValoresPriceList {
  codigo: string;
  nombre: string;
  moneda: (typeof MONEDAS)[number];
  esDefault: boolean;
  activo: boolean;
}

function parseCrear(body: unknown): { companyId: string; valores: ValoresPriceList } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    valores: {
      codigo: requireString(b.codigo, 'codigo', 30),
      nombre: requireString(b.nombre, 'nombre'),
      moneda: requireEnum(b.moneda ?? 'USD', 'moneda', MONEDAS, (s) => s.toUpperCase()),
      esDefault: optionalBoolean(b.esDefault, false),
      activo: optionalBoolean(b.activo, true),
    },
  };
}

function parseActualizar(body: unknown): Partial<ValoresPriceList> {
  const b = asRecord(body);
  const out: Partial<ValoresPriceList> = {};
  if ('nombre' in b) out.nombre = requireString(b.nombre, 'nombre');
  if ('moneda' in b) out.moneda = requireEnum(b.moneda, 'moneda', MONEDAS, (s) => s.toUpperCase());
  if ('esDefault' in b) out.esDefault = optionalBoolean(b.esDefault, false);
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  return out;
}

/**
 * Maestro de listas de precios (docs/05 §3.2, doc 06 M5). El índice parcial
 * `price_lists_una_default_por_empresa_uq` (migración 0013) impide dos listas por defecto por
 * empresa: si se marca una nueva como default, la API rechaza hasta desmarcar la anterior.
 */
@Injectable()
export class PriceListsService extends CrudMaestroService<FilaPriceList, ValoresPriceList> {
  constructor(database: DatabaseService, audit: AuditService) {
    super(database, audit, {
      tabla: priceLists,
      entidad: 'price_lists',
      accion: 'price_list',
      idCol: priceLists.id,
      companyCol: priceLists.companyId,
      ordenCol: priceLists.codigo,
      parseCrear,
      parseActualizar,
    });
  }
}
