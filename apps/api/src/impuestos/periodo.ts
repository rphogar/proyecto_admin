import { BadRequestException } from '@nestjs/common';

/** Rango de fecha fiscal (Caracas) `[desde, hasta)` de un período mensual, como strings `YYYY-MM-DD`. */
export interface RangoPeriodo {
  readonly desde: string;
  readonly hasta: string;
}

/** Valida (anio, mes) y devuelve el rango semiabierto de fecha fiscal del período. */
export function rangoPeriodo(anio: number, mes: number): RangoPeriodo {
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new BadRequestException(`Año inválido: ${anio}`);
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new BadRequestException(`Mes inválido: ${mes}`);
  }
  const sigMes = mes === 12 ? 1 : mes + 1;
  const sigAnio = mes === 12 ? anio + 1 : anio;
  return {
    desde: `${anio}-${String(mes).padStart(2, '0')}-01`,
    hasta: `${sigAnio}-${String(sigMes).padStart(2, '0')}-01`,
  };
}

/** Período inmediatamente anterior a (anio, mes). */
export function periodoAnterior(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/** Etiqueta `YYYY-MM` del período. */
export function etiquetaPeriodo(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}
