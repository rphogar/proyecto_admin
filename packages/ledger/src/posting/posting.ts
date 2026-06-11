import type { InstanteUtc } from '@contave/shared';
import { Asiento, type EntradaAsiento } from '../asientos/asiento';
import { AsientoDesbalanceadoError, verificarCuadre } from '../asientos/cuadre';
import type { EntradaLinea, LineaAsiento } from '../asientos/linea';
import type { PlanDeCuentas } from '../cuentas/plan-de-cuentas';
import { ladoOpuesto } from '../cuentas/naturaleza';
import type { LibroDePeriodos } from '../periodos/periodo';

/** Opciones de posteo (regla 4, 7, 9 de CLAUDE.md). */
export interface OpcionesPosteo {
  /** Si se pasa, revalida que cada cuenta sea de movimiento. */
  readonly plan?: PlanDeCuentas;
  /** Si se pasa, valida que el período de la fecha esté abierto (caso 42). */
  readonly periodos?: LibroDePeriodos;
}

/**
 * Postea (contabiliza) un asiento DRAFT → POSTED. Revalida el invariante ΣD=ΣC, opcionalmente
 * la imputación a cuentas de movimiento y que el período esté abierto. NO muta el asiento de
 * entrada: devuelve una copia POSTED (los POSTED son inmutables, regla 4).
 *
 * @throws si el asiento ya está POSTED, está desbalanceado o el período está cerrado.
 */
export function postear(asiento: Asiento, opciones: OpcionesPosteo = {}): Asiento {
  if (asiento.estado === 'POSTED') {
    throw new Error('El asiento ya está POSTED: los asientos posteados son inmutables (regla 4)');
  }

  // Defensa en profundidad: revalida el cuadre aunque construir() ya lo garantizó.
  const cuadre = verificarCuadre(asiento.lineas);
  if (!cuadre.balanceado) {
    throw new AsientoDesbalanceadoError(cuadre.descuadres);
  }

  if (opciones.plan) {
    for (const linea of asiento.lineas) {
      const cuenta = opciones.plan.requerirCuenta(linea.cuenta);
      if (!cuenta.esMovimiento) {
        throw new Error(
          `No se puede postear contra la cuenta totalizadora "${linea.cuenta}" (${cuenta.nombre})`,
        );
      }
    }
  }

  // Período abierto (regla 9, caso 42). Lanza PeriodoCerradoError si está cerrado.
  opciones.periodos?.validarFecha(asiento.fecha);

  return asiento.conEstado('POSTED');
}

/** Opciones para construir un reverso. */
export interface OpcionesReverso {
  /** Fecha del asiento de reverso (debe caer en un período abierto). */
  readonly fecha: InstanteUtc;
  readonly descripcion?: string;
  readonly id?: string;
}

function reversarLinea(l: LineaAsiento): EntradaLinea {
  return {
    cuenta: l.cuenta,
    dc: ladoOpuesto(l.dc),
    moneda: l.moneda,
    montoOrigen: l.montoOrigen.aCadenaDecimal(),
    montoVes: l.montoVes.aCadenaDecimal(),
    montoUsdMgmt: l.montoUsdMgmt.aCadenaDecimal(),
    rateBcv: l.rateBcv,
    rateUsdMgmt: l.rateUsdMgmt,
    esAjuste: l.esAjuste,
    ...(l.partyId !== undefined ? { partyId: l.partyId } : {}),
    ...(l.centroCosto !== undefined ? { centroCosto: l.centroCosto } : {}),
    ...(l.sucursalId !== undefined ? { sucursalId: l.sucursalId } : {}),
    ...(l.vencimiento !== undefined ? { vencimiento: l.vencimiento } : {}),
  };
}

/**
 * Construye el asiento de REVERSO de uno POSTED (docs/03 §5: correcciones por reverso, regla 4).
 *
 * Decisión de diseño (acordada): el reverso es un asiento NUEVO (DRAFT) con `reversalOf` → original
 * y los lados D/C invertidos; el original NUNCA se modifica. El estado "reversado" se DERIVA con
 * {@link estaReversado}. El reverso debe postearse luego (en un período abierto) con {@link postear}.
 *
 * @throws si el asiento no está POSTED o no tiene `id` (se necesita para enlazar `reversalOf`).
 */
export function reversar(original: Asiento, opciones: OpcionesReverso): Asiento {
  if (original.estado !== 'POSTED') {
    throw new Error('Solo se puede reversar un asiento POSTED');
  }
  if (original.id === undefined) {
    throw new Error('El asiento original necesita id para enlazar el reverso (reversalOf)');
  }

  const entrada: EntradaAsiento = {
    fecha: opciones.fecha,
    descripcion: opciones.descripcion ?? `Reverso de asiento ${original.id}`,
    lineas: original.lineas.map(reversarLinea),
    reversalOf: original.id,
    estado: 'DRAFT',
    ...(original.companyId !== undefined ? { companyId: original.companyId } : {}),
    ...(opciones.id !== undefined ? { id: opciones.id } : {}),
    ...(original.sourceType !== undefined ? { sourceType: original.sourceType } : {}),
    ...(original.sourceId !== undefined ? { sourceId: original.sourceId } : {}),
  };

  return Asiento.construir(entrada);
}

/** True si `asiento` fue reversado: existe en `todos` un asiento cuyo `reversalOf` lo apunta. */
export function estaReversado(asiento: Asiento, todos: ReadonlyArray<Asiento>): boolean {
  if (asiento.id === undefined) return false;
  return todos.some((a) => a.reversalOf === asiento.id);
}
