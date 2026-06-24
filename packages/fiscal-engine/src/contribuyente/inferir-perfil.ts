/**
 * Inferencia del PERFIL TRIBUTARIO de una empresa a partir de pocos datos del alta (docs/02 §1).
 *
 * Función pura y determinista: dado el tipo de contribuyente (ordinario/formal/especial), la forma
 * jurídica y unos pocos campos, deriva las CONSECUENCIAS que el resto del sistema necesita —
 * si cobra IVA, periodicidad, si es agente de retención IVA/ISLR, si percibe IGTF, si está excluido
 * del ajuste por inflación, tarifa de ISLR y qué series de retención hay que precargar. El onboarding
 * (P30) usa esto para configurar `companies` y la precarga; la UI muestra las consecuencias antes de
 * confirmar. No accede a IO ni a `Date`: 100% testeable.
 *
 * Citas: clasificación de sujetos y consecuencias (docs/02 §1); SPE como agente de retención e
 * IGTF y exclusión del ajuste por inflación (docs/02 §3.3, §4, §5); ISLR PJ 34% (docs/02 §4).
 */

/** Clasificación SENIAT del contribuyente (docs/02 §1). */
export type TipoContribuyente = 'ORDINARIO' | 'FORMAL' | 'ESPECIAL';

/** Forma jurídica del sujeto: persona natural (PN) o jurídica (PJ). */
export type FormaJuridica = 'PN' | 'PJ';

/** Periodicidad de declaración del IVA (docs/02 §3.2). */
export type PeriodicidadIva = 'MENSUAL' | 'CALENDARIO_SPE';

/** Clase de riesgo ocupacional IVSS (informativa para nómina; docs/04). */
export type RiesgoIvss = 'minimo' | 'medio' | 'maximo';

export interface PerfilInput {
  readonly tipoContribuyente: TipoContribuyente;
  readonly formaJuridica: FormaJuridica;
  /** Si el SENIAT lo designó agente de retención de ISLR aun no siendo SPE (raro pero posible). */
  readonly esAgenteRetencionIslr?: boolean;
  /** % de IVA que le retienen sus clientes SPE cuando actúa como proveedor (75 o 100). */
  readonly pctRetencionQueLeAplican?: 75 | 100 | null;
  /** Mes de inicio del ejercicio fiscal (1–12). Default enero. */
  readonly ejercicioFiscalInicio?: number;
  /** Clase de riesgo ocupacional (nómina). */
  readonly riesgoIvss?: RiesgoIvss | null;
  /** Días de utilidades que paga la empresa (15–120). */
  readonly diasUtilidades?: number | null;
}

export interface PerfilInferido {
  readonly tipoContribuyente: TipoContribuyente;
  readonly esSpe: boolean;
  /** Si emite débito fiscal de IVA en sus ventas (el formal solo hace operaciones exentas). */
  readonly cobraIva: boolean;
  readonly periodicidadIva: PeriodicidadIva;
  /** Agente de retención de IVA (75/100): solo los SPE y entes públicos (Providencia 0049). */
  readonly esAgenteRetencionIva: boolean;
  readonly esAgenteRetencionIslr: boolean;
  /** Agente de PERCEPCIÓN del IGTF sobre pagos en divisas (solo SPE designados, docs/02 §5). */
  readonly percibeIgtf: boolean;
  /** Los SPE están excluidos del ajuste por inflación fiscal (reforma 2015, docs/02 §4). */
  readonly excluidoAjusteInflacion: boolean;
  /** Tarifa de ISLR aplicable a personas jurídicas (la mayoría de PYMEs: 34%). `null` para PN. */
  readonly alicuotaIslrPj: number | null;
  /** % de IVA que le retienen como proveedor de un SPE (75/100), si aplica. */
  readonly pctRetencionQueLeAplican: 75 | 100 | null;
  readonly ejercicioFiscalInicio: number;
  readonly riesgoIvss: RiesgoIvss | null;
  readonly diasUtilidades: number | null;
  /** Tipos de serie de retención a precargar (solo si actúa como agente). */
  readonly seriesRetencion: ReadonlyArray<'COMPROBANTE_RETENCION_IVA' | 'COMPROBANTE_RETENCION_ISLR'>;
}

/** Tarifa N° 2 de ISLR para personas jurídicas: la mayoría de las PYMEs cae en 34% (docs/02 §4). */
// TODO-TRIBUTARISTA: los tramos por UT (15/22/34) y la Tarifa N° 1 de PN se modelarán en el motor de
// ISLR; aquí se infiere la marginal típica de PYME PJ para preconfigurar la empresa.
const ALICUOTA_ISLR_PJ_PYME = 34;

/** Días de utilidades por defecto (mínimo legal LOTTT). El alta puede subirlo (15–120). */
// TODO-TRIBUTARISTA: el mínimo legal son 15 días; muchas empresas pagan 30+. Se usa el mínimo como
// default conservador y el asistente permite ajustarlo.
const DIAS_UTILIDADES_DEFECTO = 15;

function normalizarMes(mes: number | undefined): number {
  if (mes === undefined || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return 1;
  }
  return mes;
}

function normalizarDiasUtilidades(dias: number | null | undefined): number | null {
  if (dias === null || dias === undefined) {
    return DIAS_UTILIDADES_DEFECTO;
  }
  if (!Number.isInteger(dias) || dias < 15 || dias > 120) {
    return DIAS_UTILIDADES_DEFECTO;
  }
  return dias;
}

/**
 * Deriva el perfil tributario completo a partir de los datos del alta. Determinista.
 */
export function inferirPerfilTributario(entrada: PerfilInput): PerfilInferido {
  const esSpe = entrada.tipoContribuyente === 'ESPECIAL';
  const esFormal = entrada.tipoContribuyente === 'FORMAL';

  // El SPE es agente de retención de IVA e ISLR y percibe IGTF; declara según el calendario especial
  // y está excluido del ajuste por inflación (docs/02 §1, §3.3, §4, §5).
  const esAgenteRetencionIva = esSpe;
  const esAgenteRetencionIslr = esSpe || (entrada.esAgenteRetencionIslr ?? false);
  const percibeIgtf = esSpe;

  const seriesRetencion: Array<'COMPROBANTE_RETENCION_IVA' | 'COMPROBANTE_RETENCION_ISLR'> = [];
  if (esAgenteRetencionIva) seriesRetencion.push('COMPROBANTE_RETENCION_IVA');
  if (esAgenteRetencionIslr) seriesRetencion.push('COMPROBANTE_RETENCION_ISLR');

  return {
    tipoContribuyente: entrada.tipoContribuyente,
    esSpe,
    // El contribuyente formal solo realiza operaciones exentas/exoneradas: no cobra IVA (docs/02 §1).
    cobraIva: !esFormal,
    periodicidadIva: esSpe ? 'CALENDARIO_SPE' : 'MENSUAL',
    esAgenteRetencionIva,
    esAgenteRetencionIslr,
    percibeIgtf,
    excluidoAjusteInflacion: esSpe,
    alicuotaIslrPj: entrada.formaJuridica === 'PJ' ? ALICUOTA_ISLR_PJ_PYME : null,
    pctRetencionQueLeAplican: entrada.pctRetencionQueLeAplican ?? null,
    ejercicioFiscalInicio: normalizarMes(entrada.ejercicioFiscalInicio),
    riesgoIvss: entrada.riesgoIvss ?? null,
    diasUtilidades: normalizarDiasUtilidades(entrada.diasUtilidades),
    seriesRetencion,
  };
}
