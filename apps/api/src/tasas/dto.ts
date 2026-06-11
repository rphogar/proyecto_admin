import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@contave/shared';
import type { MonedaBcv } from './fuentes/fuente-bcv';

const MONEDAS: readonly MonedaBcv[] = ['USD', 'EUR'];
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida y normaliza una moneda soportada por P4 (USD|EUR). */
export function validarMoneda(valor: unknown): MonedaBcv {
  const m = String(valor ?? '').trim().toUpperCase();
  if (!MONEDAS.includes(m as MonedaBcv)) {
    throw new BadRequestException(`Moneda no soportada: "${String(valor)}" (use USD o EUR)`);
  }
  return m as MonedaBcv;
}

/** Valida una fecha civil `'YYYY-MM-DD'`. */
export function validarFecha(valor: unknown, campo = 'fecha'): string {
  const f = String(valor ?? '').trim();
  if (!PATRON_FECHA.test(f) || Number.isNaN(Date.parse(f))) {
    throw new BadRequestException(`${campo} inválida (se espera YYYY-MM-DD): "${String(valor)}"`);
  }
  return f;
}

/** Valida un monto de tasa: Decimal-string positivo (regla 1: nunca float silencioso). */
export function validarRate(valor: unknown): string {
  const s = String(valor ?? '').trim();
  let d: Decimal;
  try {
    d = new Decimal(s);
  } catch {
    throw new BadRequestException(`Tasa inválida: "${String(valor)}"`);
  }
  if (!d.isFinite() || d.lte(0)) {
    throw new BadRequestException(`La tasa debe ser un número positivo: "${String(valor)}"`);
  }
  return d.toFixed();
}

/** Cuerpo de una entrada manual de tasa (entrada auditada). */
export interface CrearTasaManualInput {
  moneda: MonedaBcv;
  rate: string;
  rateDate: string;
  motivo: string;
}

export function parsearTasaManual(body: unknown): CrearTasaManualInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const motivo = String(b.motivo ?? '').trim();
  if (motivo.length < 3) {
    throw new BadRequestException('El motivo de la entrada manual es obligatorio (regla 5)');
  }
  return {
    moneda: validarMoneda(b.moneda),
    rate: validarRate(b.rate),
    rateDate: validarFecha(b.rateDate, 'rateDate'),
    motivo,
  };
}
