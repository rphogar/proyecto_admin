import { type InstanteUtc, periodoFiscal } from '@contave/shared';

/** Estado de un período contable mensual (docs/05 §3.5). */
export type EstadoPeriodo = 'OPEN' | 'CLOSED';

/** Período contable: mes calendario (en hora de Caracas) de una empresa. */
export interface Periodo {
  readonly anio: number;
  readonly mes: number;
  readonly estado: EstadoPeriodo;
}

/** Identidad de un período `YYYY-MM`. */
export interface ClavePeriodo {
  readonly anio: number;
  readonly mes: number;
}

function clave(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/** Período fiscal (mes en Caracas) al que pertenece un instante (regla 15 de CLAUDE.md). */
export function periodoDeFecha(fecha: InstanteUtc): ClavePeriodo {
  return periodoFiscal(fecha);
}

/**
 * Error al intentar registrar un asiento con fecha en un período CERRADO (regla 9, caso 42).
 * Lleva el período afectado para que la capa superior ofrezca "registrar en el período abierto
 * con referencia al cerrado".
 */
export class PeriodoCerradoError extends Error {
  readonly periodo: ClavePeriodo;
  constructor(periodo: ClavePeriodo) {
    super(
      `El período ${clave(periodo.anio, periodo.mes)} está cerrado: no acepta asientos con fecha ` +
        `dentro del período (regla 9). Registrá el ajuste en el período abierto con referencia.`,
    );
    this.name = 'PeriodoCerradoError';
    this.periodo = periodo;
  }
}

/**
 * Libro de períodos de una empresa (inmutable). Los períodos no registrados se consideran
 * ABIERTOS por defecto (un período solo bloquea asientos tras CERRARSE explícitamente).
 */
export class LibroDePeriodos {
  private readonly porClave: ReadonlyMap<string, Periodo>;

  private constructor(porClave: ReadonlyMap<string, Periodo>) {
    this.porClave = porClave;
  }

  static desde(periodos: ReadonlyArray<Periodo> = []): LibroDePeriodos {
    const mapa = new Map<string, Periodo>();
    for (const p of periodos) {
      if (!Number.isInteger(p.mes) || p.mes < 1 || p.mes > 12) {
        throw new Error(`Mes de período inválido: ${p.mes}`);
      }
      mapa.set(clave(p.anio, p.mes), p);
    }
    return new LibroDePeriodos(mapa);
  }

  /** Estado del período (OPEN si no está registrado). */
  estadoDe(anio: number, mes: number): EstadoPeriodo {
    return this.porClave.get(clave(anio, mes))?.estado ?? 'OPEN';
  }

  estaAbierto(anio: number, mes: number): boolean {
    return this.estadoDe(anio, mes) === 'OPEN';
  }

  /** Lanza {@link PeriodoCerradoError} si el período de `fecha` está cerrado (caso 42). */
  validarFecha(fecha: InstanteUtc): void {
    const { anio, mes } = periodoDeFecha(fecha);
    if (!this.estaAbierto(anio, mes)) {
      throw new PeriodoCerradoError({ anio, mes });
    }
  }

  /** Cierra (bloquea) un período. Idempotente. Devuelve un libro nuevo (inmutable). */
  cerrar(anio: number, mes: number): LibroDePeriodos {
    return this.conEstado(anio, mes, 'CLOSED');
  }

  /** Reabre un período (solo owner/contador en la capa de app; caso 43). Libro nuevo. */
  reabrir(anio: number, mes: number): LibroDePeriodos {
    return this.conEstado(anio, mes, 'OPEN');
  }

  private conEstado(anio: number, mes: number, estado: EstadoPeriodo): LibroDePeriodos {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new Error(`Mes de período inválido: ${mes}`);
    }
    const mapa = new Map(this.porClave);
    mapa.set(clave(anio, mes), { anio, mes, estado });
    return new LibroDePeriodos(mapa);
  }

  periodos(): Periodo[] {
    return [...this.porClave.values()];
  }
}

/**
 * Sufijo de descripción para un asiento de ajuste que se registra en el período abierto pero
 * afecta a uno ya cerrado (caso 42 / docs/03 §5, regla 9). No mueve la fecha al período cerrado;
 * deja constancia del período afectado.
 */
export function referenciaAPeriodoAfectado(anioAfectado: number, mesAfectado: number): string {
  return `[Ajuste con efecto en período ${clave(anioAfectado, mesAfectado)} (cerrado)]`;
}
