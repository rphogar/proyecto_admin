import {
  fechaFiscal,
  type InstanteUtc,
  Money,
  periodoFiscal,
} from '@contave/shared';
import type { PlanDeCuentas } from '../cuentas/plan-de-cuentas';
import { AsientoDesbalanceadoError, verificarCuadre } from './cuadre';
import { type EntradaLinea, LineaAsiento, MONEDA_USD_MGMT, MONEDA_VES } from './linea';

/** Estado del asiento (docs/05 §3.5). REVERSED se DERIVA (no se persiste): un asiento está
 * reversado sii existe otro con `reversalOf` apuntándolo. */
export type EstadoAsiento = 'DRAFT' | 'POSTED';

/** Entrada para construir un asiento. La `fecha` es el instante (UTC); la fecha fiscal y el
 * período se derivan en hora de Caracas (regla 15 de CLAUDE.md). */
export interface EntradaAsiento {
  readonly id?: string;
  readonly companyId?: string;
  readonly fecha: InstanteUtc;
  readonly descripcion: string;
  readonly lineas: ReadonlyArray<EntradaLinea>;
  /** Documento/origen del asiento (factura, pago, nómina…). */
  readonly sourceType?: string;
  readonly sourceId?: string;
  /** Si es un asiento de reverso: id del asiento original. */
  readonly reversalOf?: string;
  readonly estado?: EstadoAsiento;
}

/** Opciones de construcción/validación. */
export interface OpcionesAsiento {
  /** Si se pasa, valida que cada cuenta exista y sea de movimiento (hoja). */
  readonly plan?: PlanDeCuentas;
}

/**
 * Asiento contable: cabecera + líneas en triple base, con el invariante ΣD=ΣC garantizado al
 * construirse (docs/03 §1, regla 7). Inmutable. Los documentos POSTED son inmutables (regla 4);
 * para corregir se usa un reverso (asiento nuevo), nunca se modifica el original.
 */
export class Asiento {
  readonly id: string | undefined;
  readonly companyId: string | undefined;
  readonly fecha: Date;
  /** Fecha fiscal (civil en Caracas) `YYYY-MM-DD`. */
  readonly fechaFiscal: string;
  readonly anio: number;
  readonly mes: number;
  readonly descripcion: string;
  readonly lineas: ReadonlyArray<LineaAsiento>;
  readonly estado: EstadoAsiento;
  readonly sourceType: string | undefined;
  readonly sourceId: string | undefined;
  readonly reversalOf: string | undefined;

  private constructor(props: {
    id: string | undefined;
    companyId: string | undefined;
    fecha: Date;
    fechaFiscal: string;
    anio: number;
    mes: number;
    descripcion: string;
    lineas: ReadonlyArray<LineaAsiento>;
    estado: EstadoAsiento;
    sourceType: string | undefined;
    sourceId: string | undefined;
    reversalOf: string | undefined;
  }) {
    this.id = props.id;
    this.companyId = props.companyId;
    this.fecha = props.fecha;
    this.fechaFiscal = props.fechaFiscal;
    this.anio = props.anio;
    this.mes = props.mes;
    this.descripcion = props.descripcion;
    this.lineas = props.lineas;
    this.estado = props.estado;
    this.sourceType = props.sourceType;
    this.sourceId = props.sourceId;
    this.reversalOf = props.reversalOf;
    Object.freeze(this);
  }

  /** Construye y valida un asiento (cuadre triple base; opcionalmente imputación a hojas). */
  static construir(entrada: EntradaAsiento, opciones: OpcionesAsiento = {}): Asiento {
    if (entrada.descripcion.trim() === '') {
      throw new Error('El asiento requiere una descripción');
    }
    if (entrada.lineas.length < 2) {
      throw new Error('Un asiento requiere al menos dos líneas (una al debe y otra al haber)');
    }

    const lineas = entrada.lineas.map((l) => LineaAsiento.desde(l));

    const hayDebito = lineas.some((l) => l.dc === 'D');
    const hayCredito = lineas.some((l) => l.dc === 'C');
    if (!hayDebito || !hayCredito) {
      throw new Error('Un asiento requiere al menos una línea al debe y una al haber');
    }

    if (opciones.plan) {
      for (const linea of lineas) {
        const cuenta = opciones.plan.requerirCuenta(linea.cuenta);
        if (!cuenta.esMovimiento) {
          throw new Error(
            `No se puede imputar a la cuenta totalizadora "${linea.cuenta}" (${cuenta.nombre}); ` +
              `solo a cuentas de movimiento (hojas)`,
          );
        }
      }
    }

    const cuadre = verificarCuadre(lineas);
    if (!cuadre.balanceado) {
      throw new AsientoDesbalanceadoError(cuadre.descuadres);
    }

    const fecha = aDate(entrada.fecha);
    const { anio, mes } = periodoFiscal(fecha);

    return new Asiento({
      id: entrada.id,
      companyId: entrada.companyId,
      fecha,
      fechaFiscal: fechaFiscal(fecha),
      anio,
      mes,
      descripcion: entrada.descripcion,
      lineas,
      estado: entrada.estado ?? 'DRAFT',
      sourceType: entrada.sourceType,
      sourceId: entrada.sourceId,
      reversalOf: entrada.reversalOf,
    });
  }

  /** Total al debe en la base fiscal (VES). */
  totalDebeVes(): Money {
    return this.totalLado('D', 'VES');
  }
  /** Total al haber en la base fiscal (VES). */
  totalHaberVes(): Money {
    return this.totalLado('C', 'VES');
  }

  private totalLado(lado: 'D' | 'C', base: 'VES' | 'USD'): Money {
    const moneda = base === 'VES' ? MONEDA_VES : MONEDA_USD_MGMT;
    return this.lineas
      .filter((l) => l.dc === lado)
      .reduce((acc, l) => acc.suma(l.montoEnBase(base)), Money.cero(moneda));
  }

  /** Devuelve una copia con otro estado (uso interno del posting; no muta el original). */
  conEstado(estado: EstadoAsiento): Asiento {
    return new Asiento({
      id: this.id,
      companyId: this.companyId,
      fecha: this.fecha,
      fechaFiscal: this.fechaFiscal,
      anio: this.anio,
      mes: this.mes,
      descripcion: this.descripcion,
      lineas: this.lineas,
      estado,
      sourceType: this.sourceType,
      sourceId: this.sourceId,
      reversalOf: this.reversalOf,
    });
  }
}

function aDate(ts: InstanteUtc): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts);
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha de asiento inválida: ${String(ts)}`);
  }
  return d;
}
