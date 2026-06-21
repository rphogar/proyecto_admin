/**
 * Observabilidad de la cola de remisión al SENIAT (P25, Providencia 121 §6.3 req. 2). Funciones
 * **puras y deterministas** (testeables sin BD): agregan el estado de la cola y evalúan alertas
 * operativas. La norma exige remisión "continua, inmediata y fehaciente"; un pendiente que envejece o
 * una tasa de error alta significan que algo del canal está fallando → hay que verlo y alertar.
 *
 * Los umbrales son **SLOs operativos** del proveedor (no valores normativos): viven como constantes
 * documentadas, no en `fiscal_params`. Si se quisieran ajustar por tenant en el futuro, se parametrizan.
 */

/** Conteo de ítems de la cola por estado. */
export interface ConteosCola {
  readonly pendiente: number;
  readonly enviado: number;
  readonly acusado: number;
  readonly error: number;
  readonly total: number;
}

/** Severidad de una alerta operativa. */
export type SeveridadAlerta = 'alta' | 'media';

/** Código de la condición que disparó la alerta. */
export type CodigoAlerta = 'BACKLOG_ELEGIBLE' | 'PENDIENTE_ANTIGUO' | 'TASA_ERROR_ALTA';

export interface AlertaRemision {
  readonly codigo: CodigoAlerta;
  readonly severidad: SeveridadAlerta;
  readonly mensaje: string;
}

/** Foto del estado de salud de la cola para un tenant (opcionalmente una empresa). */
export interface EstadoCola {
  readonly conteos: ConteosCola;
  /** Ítems listos para procesar ahora (PENDIENTE/ENVIADO con `proximo_intento` vencido). */
  readonly pendientesElegibles: number;
  /** Antigüedad en segundos del ítem sin acusar más viejo (PENDIENTE/ENVIADO); null si no hay. */
  readonly antiguedadPendienteSegundos: number | null;
  /** Proporción de errores sobre los desenlaces terminales (acusado+error); 0 si no hubo ninguno. */
  readonly tasaError: number;
  readonly alertas: readonly AlertaRemision[];
}

/** Umbrales operativos por defecto para las alertas. */
export const UMBRALES_REMISION = {
  /** Backlog elegible que se considera anómalo (algo no está drenando la cola). */
  backlogElegible: 100,
  /** Antigüedad (s) del pendiente más viejo que dispara alerta media (1 h). */
  antiguedadMediaSegundos: 3600,
  /** Antigüedad (s) que dispara alerta alta (6 h: la remisión "inmediata" lleva demasiado retraso). */
  antiguedadAltaSegundos: 6 * 3600,
  /** Tasa de error a partir de la cual se alerta (20 % de los desenlaces terminales fallan). */
  tasaErrorAlta: 0.2,
  /** Mínimo de desenlaces terminales para que la tasa de error sea significativa. */
  minTerminalesParaTasa: 10,
} as const;

export type UmbralesRemision = typeof UMBRALES_REMISION;

/** Proporción de errores sobre los desenlaces terminales (acusado + error). 0 si no hubo ninguno. */
export function tasaError(acusados: number, errores: number): number {
  const terminales = acusados + errores;
  return terminales === 0 ? 0 : errores / terminales;
}

/**
 * Evalúa las alertas operativas sobre el estado de la cola. Pura: misma entrada → misma salida.
 * No alerta sobre la tasa de error si la muestra de desenlaces terminales es muy pequeña (ruido).
 */
export function evaluarAlertas(
  estado: Pick<EstadoCola, 'conteos' | 'pendientesElegibles' | 'antiguedadPendienteSegundos' | 'tasaError'>,
  umbrales: UmbralesRemision = UMBRALES_REMISION,
): AlertaRemision[] {
  const alertas: AlertaRemision[] = [];

  const antiguedad = estado.antiguedadPendienteSegundos;
  if (antiguedad !== null && antiguedad >= umbrales.antiguedadMediaSegundos) {
    const horas = Math.floor(antiguedad / 3600);
    alertas.push({
      codigo: 'PENDIENTE_ANTIGUO',
      severidad: antiguedad >= umbrales.antiguedadAltaSegundos ? 'alta' : 'media',
      mensaje: `El registro sin acusar más antiguo lleva ~${horas} h en cola (remisión no es inmediata)`,
    });
  }

  if (estado.pendientesElegibles >= umbrales.backlogElegible) {
    alertas.push({
      codigo: 'BACKLOG_ELEGIBLE',
      severidad: 'media',
      mensaje: `${estado.pendientesElegibles} registros elegibles sin remitir acumulados en la cola`,
    });
  }

  const terminales = estado.conteos.acusado + estado.conteos.error;
  if (terminales >= umbrales.minTerminalesParaTasa && estado.tasaError >= umbrales.tasaErrorAlta) {
    const pct = Math.round(estado.tasaError * 100);
    alertas.push({
      codigo: 'TASA_ERROR_ALTA',
      severidad: estado.tasaError >= 0.5 ? 'alta' : 'media',
      mensaje: `Tasa de error de remisión en ${pct}% (${estado.conteos.error}/${terminales})`,
    });
  }

  return alertas;
}
