import { Decimal, REDONDEO_FISCAL } from '@contave/shared';
import { calcularRetencionIslr, sustraendoIslr, type ResultadoRetencionIslr } from './retencion-islr';

/**
 * Tabla del **Decreto 1.808** (Reglamento Parcial de la Ley de ISLR en materia de retenciones;
 * docs/02 §4; caso 31 del doc 07). Función PURA y determinista.
 *
 * El motor de {@link calcularRetencionIslr} aplica la fórmula `retención = base×tarifa% − sustraendo`
 * pero NO conoce la tabla de conceptos. Este módulo materializa esa tabla como **dato
 * parametrizable** (regla 17 de CLAUDE.md): un catálogo de conceptos con su tarifa para persona
 * natural residente (PN) y persona jurídica domiciliada (PJ), si lleva sustraendo, y la porción de la
 * base sobre la que se retiene. El resolver elige tarifa y sustraendo según el tipo de persona y
 * compone el motor de retención. Así la "tabla 1.808 completa" vive en parámetros y la fórmula en el
 * motor: una sola fuente de cálculo, sin números mágicos.
 *
 * El catálogo {@link TABLA_1808_DEFECTO} es un punto de partida derivado de docs/02 §4; el sistema lo
 * sobreescribe con el parámetro `RETENCION_ISLR_1808` sembrado por tenant. TODO-TRIBUTARISTA: validar
 * artículo por artículo tarifas, conceptos faltantes (sueldos/ARI van por nómina; dividendos, premios,
 * ganancias fortuitas, no residentes/no domiciliados con tarifas proporcionales), la porción gravable
 * de fletes/transporte y el factor del sustraendo vigentes contra el Decreto y la UT del ejercicio.
 */

/** Tipo de persona del sujeto retenido que determina la tarifa y el sustraendo aplicables. */
export type TipoPersonaIslr = 'PN_RESIDENTE' | 'PJ_DOMICILIADA';

/** Un concepto de la tabla 1.808 (parametrizable). */
export interface ConceptoIslr1808 {
  /** Código estable del concepto (p. ej. '001'); se referencia desde la compra. */
  readonly codigo: string;
  /** Descripción legible (honorarios profesionales, servicios, arrendamiento…). */
  readonly descripcion: string;
  /** Tarifa para PN residente en % (string); null si el concepto no aplica a PN. */
  readonly tarifaPnResidente: string | null;
  /** Tarifa para PJ domiciliada en % (string); null si no aplica a PJ. */
  readonly tarifaPjDomiciliada: string | null;
  /** La retención a PN lleva sustraendo (mínimo exento). Las PJ nunca llevan sustraendo. */
  readonly aplicaSustraendoPn: boolean;
  /**
   * Porción de la base del pago sobre la que se retiene, en % (default 100). Algunos conceptos
   * (p. ej. transporte/fletes en ciertos supuestos) retienen sobre una fracción del monto pagado;
   * parametrizable. TODO-TRIBUTARISTA.
   */
  readonly porcentajeBaseGravable?: string;
}

/** Catálogo 1.808 completo: un mapa de código → concepto. */
export type Tabla1808 = ReadonlyArray<ConceptoIslr1808>;

/**
 * Catálogo por defecto derivado de docs/02 §4 (tabla mínima). Se usa solo si el tenant no tiene el
 * parámetro `RETENCION_ISLR_1808` vigente sembrado. TODO-TRIBUTARISTA.
 */
export const TABLA_1808_DEFECTO: Tabla1808 = [
  { codigo: '001', descripcion: 'Honorarios profesionales', tarifaPnResidente: '3', tarifaPjDomiciliada: '5', aplicaSustraendoPn: true },
  { codigo: '002', descripcion: 'Servicios (contratistas y subcontratistas)', tarifaPnResidente: '1', tarifaPjDomiciliada: '2', aplicaSustraendoPn: true },
  { codigo: '003', descripcion: 'Arrendamiento de bienes inmuebles', tarifaPnResidente: '3', tarifaPjDomiciliada: '5', aplicaSustraendoPn: true },
  { codigo: '004', descripcion: 'Fletes (transporte de bienes)', tarifaPnResidente: '1', tarifaPjDomiciliada: '3', aplicaSustraendoPn: true },
  { codigo: '005', descripcion: 'Publicidad y propaganda', tarifaPnResidente: '3', tarifaPjDomiciliada: '5', aplicaSustraendoPn: true },
  { codigo: '006', descripcion: 'Publicidad — medios de comunicación', tarifaPnResidente: '3', tarifaPjDomiciliada: '3', aplicaSustraendoPn: true },
  { codigo: '007', descripcion: 'Comisiones', tarifaPnResidente: '3', tarifaPjDomiciliada: '5', aplicaSustraendoPn: true },
  { codigo: '008', descripcion: 'Intereses', tarifaPnResidente: '3', tarifaPjDomiciliada: '5', aplicaSustraendoPn: true },
];

/** Busca un concepto en la tabla por su código; null si no existe. */
export function resolverConcepto1808(tabla: Tabla1808, codigo: string): ConceptoIslr1808 | null {
  const c = tabla.find((x) => x.codigo === codigo.trim());
  return c ?? null;
}

export interface RetencionPorConceptoInput {
  /** Concepto de la tabla a aplicar. */
  readonly concepto: ConceptoIslr1808;
  /** Tipo de persona del retenido (decide tarifa y sustraendo). */
  readonly tipoPersona: TipoPersonaIslr;
  /** Base del pago/abono sujeto al concepto (en la moneda del comprobante). */
  readonly base: string | number;
  /**
   * Valor de la UT vigente, para derivar el sustraendo de PN. Requerido si el concepto lleva
   * sustraendo y la persona es PN residente; ignorado en otros casos.
   */
  readonly valorUt?: string | number | null;
  /** Factor del sustraendo (default {@link FACTOR_SUSTRAENDO_PN} en retencion-islr). */
  readonly factorSustraendo?: string | number;
}

export interface ResultadoRetencion1808 extends ResultadoRetencionIslr {
  /** Código del concepto aplicado. */
  readonly concepto: string;
  /** Tipo de persona usado para elegir tarifa/sustraendo. */
  readonly tipoPersona: TipoPersonaIslr;
  /** Base del pago antes de aplicar la porción gravable. */
  readonly basePago: string;
}

/**
 * Resuelve tarifa y sustraendo de un concepto de la tabla 1.808 según el tipo de persona y calcula la
 * retención de ISLR componiendo {@link calcularRetencionIslr}.
 *  - PN residente: tarifa de PN; sustraendo derivado de la UT (si el concepto lo lleva y hay UT).
 *  - PJ domiciliada: tarifa de PJ; sin sustraendo (caso 31 contraparte).
 * La base efectiva es `base × porcentajeBaseGravable%` (default 100%).
 *
 * @throws si el concepto no tiene tarifa para el tipo de persona indicado.
 */
export function calcularRetencion1808(
  input: RetencionPorConceptoInput,
  opciones: { decimales?: number } = {},
): ResultadoRetencion1808 {
  const decimales = opciones.decimales ?? 2;
  const { concepto, tipoPersona } = input;
  const tarifa = tipoPersona === 'PN_RESIDENTE' ? concepto.tarifaPnResidente : concepto.tarifaPjDomiciliada;
  if (tarifa === null) {
    throw new Error(`calcularRetencion1808: el concepto ${concepto.codigo} no tiene tarifa para ${tipoPersona}`);
  }

  // Porción de la base gravable (default 100%).
  const basePago = new Decimal(input.base);
  const pctBase = new Decimal(concepto.porcentajeBaseGravable ?? '100');
  const baseGravable = basePago.times(pctBase).div(100);

  // Sustraendo: solo PN residente y solo si el concepto lo lleva; requiere UT.
  let sustraendo: string | null = null;
  if (tipoPersona === 'PN_RESIDENTE' && concepto.aplicaSustraendoPn) {
    if (input.valorUt === undefined || input.valorUt === null || String(input.valorUt).trim() === '') {
      throw new Error(
        `calcularRetencion1808: el concepto ${concepto.codigo} para PN residente requiere valorUt para derivar el sustraendo`,
      );
    }
    sustraendo = sustraendoIslr({ valorUt: input.valorUt, tarifa, ...(input.factorSustraendo !== undefined ? { factor: input.factorSustraendo } : {}) }, { decimales });
  }

  const r = calcularRetencionIslr({ base: baseGravable.toFixed(), tarifa, sustraendo }, { decimales });
  return { ...r, concepto: concepto.codigo, tipoPersona, basePago: basePago.toDecimalPlaces(decimales, REDONDEO_FISCAL).toFixed(decimales) };
}
