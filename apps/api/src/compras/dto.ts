import { BadRequestException } from '@nestjs/common';
import type { AlicuotaCodigo } from '@contave/fiscal-engine';
import type { LineaBorrador } from '../documentos/calculo-documento';
import {
  asRecord,
  optionalDecimal,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
} from '../maestros/validacion';

const ALICUOTAS = ['GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'] as const;

/** Parsea una línea de compra (misma forma que la de venta; importes en moneda origen). */
export function parseLineaCompra(raw: unknown, i: number): LineaBorrador {
  const b = asRecord(raw);
  return {
    itemId: optionalUuid(b.itemId, `lineas[${i}].itemId`),
    descripcion: requireString(b.descripcion, `lineas[${i}].descripcion`, 1000),
    cantidad: requireDecimal(b.cantidad, `lineas[${i}].cantidad`),
    precioUnitarioOrigen: requireDecimal(b.precioUnitarioOrigen, `lineas[${i}].precioUnitarioOrigen`, true),
    descuentoOrigen: optionalDecimal(b.descuentoOrigen, `lineas[${i}].descuentoOrigen`),
    alicuotaCodigo: requireEnum(b.alicuotaCodigo, `lineas[${i}].alicuotaCodigo`, ALICUOTAS, (s) => s.toUpperCase()) as AlicuotaCodigo,
    alicuotaTasa: requireDecimal(b.alicuotaTasa, `lineas[${i}].alicuotaTasa`, true),
  };
}

/** Valida y parsea el arreglo de líneas (al menos una). */
export function parseLineas(raw: unknown): LineaBorrador[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException('La compra requiere al menos una línea');
  }
  return raw.map(parseLineaCompra);
}
