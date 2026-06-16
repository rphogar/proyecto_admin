/**
 * Derivación pura del calendario de obligaciones tributarias por empresa (P16, docs/02 §10, docs/06
 * M11). Sin IO ni dependencias de Nest → se prueba en unidad. Generaliza el "semáforo fiscal" del
 * dashboard (P14) al portal del contador: una fila por (empresa, tipo, período) con su fecha límite,
 * días restantes y estado (PRESENTADA / PENDIENTE) tomado de las declaraciones realmente presentadas.
 *
 * Alcance v1 (lo que el sistema puede verificar hoy contra `tax_returns`): IVA mensual para todos y
 * IGTF percibido para Sujetos Pasivos Especiales designados. El resto del calendario (retenciones,
 * ISLR, ISAE, parafiscales) y, sobre todo, el **calendario SPE por dígito terminal del RIF** se
 * publica por providencia y debe entrar como parámetro con vigencia (regla 17), no como código.
 *
 * TODO-TRIBUTARISTA: los SPE declaran IVA y enteran retenciones según el calendario especial del
 * SENIAT (por terminal de RIF, quincenal); aquí se aproxima con la regla ordinaria (día 15 del mes
 * siguiente) hasta importar ese calendario como datos. Validar con tributarista antes de producción.
 */

/** Día del mes siguiente en que vence la declaración mensual del contribuyente ordinario. */
const DIA_VENCIMIENTO_DEFECTO = 15;

/** Perfil mínimo de la empresa necesario para derivar sus obligaciones. */
export interface PerfilEmpresa {
  readonly companyId: string;
  readonly rif: string;
  readonly razonSocial: string;
  /** ORDINARIO | ESPECIAL | FORMAL. */
  readonly tipoContribuyente: string;
  /** Sujeto Pasivo Especial designado (agente de percepción de IGTF). */
  readonly spe: boolean;
}

export type TipoObligacion = 'IVA' | 'IGTF';

export interface ObligacionPortal {
  readonly companyId: string;
  readonly rif: string;
  readonly razonSocial: string;
  readonly tipo: TipoObligacion;
  /** Período fiscal al que corresponde la obligación, `'YYYY-MM'`. */
  readonly periodo: string;
  /** Fecha límite de presentación/pago, `'YYYY-MM-DD'` (hora de Caracas). */
  readonly fechaLimite: string;
  /** Días entre la fecha límite y hoy (negativo = ya vencida). */
  readonly diasRestantes: number;
  readonly estado: 'PRESENTADA' | 'PENDIENTE';
}

export interface PeriodoFiscal {
  readonly anio: number;
  readonly mes: number;
}

/**
 * Obligaciones de una empresa para los `periodos` dados (típicamente el mes en curso y el anterior,
 * cuyas declaraciones pueden estar pendientes). `presentadas` es el conjunto de claves
 * `'TIPO-AAAA-M'` de las declaraciones en estado PRESENTADA, para marcar el estado sin volver a la BD.
 */
export function obligacionesDeEmpresa(
  empresa: PerfilEmpresa,
  hoy: string,
  periodos: ReadonlyArray<PeriodoFiscal>,
  presentadas: ReadonlySet<string>,
): ObligacionPortal[] {
  const tipos: TipoObligacion[] = empresa.spe ? ['IVA', 'IGTF'] : ['IVA'];
  const obligaciones: ObligacionPortal[] = [];
  for (const p of periodos) {
    for (const tipo of tipos) {
      const fechaLimite = vencimientoMensual(p.anio, p.mes);
      obligaciones.push({
        companyId: empresa.companyId,
        rif: empresa.rif,
        razonSocial: empresa.razonSocial,
        tipo,
        periodo: etiquetaPeriodo(p.anio, p.mes),
        fechaLimite,
        diasRestantes: diferenciaDias(fechaLimite, hoy),
        estado: presentadas.has(claveDeclaracion(tipo, p.anio, p.mes)) ? 'PRESENTADA' : 'PENDIENTE',
      });
    }
  }
  return obligaciones;
}

/** Clave canónica de una declaración presentada: `'TIPO-AAAA-M'` (mes sin padding, como en BD). */
export function claveDeclaracion(tipo: string, anio: number, mes: number): string {
  return `${tipo}-${anio}-${mes}`;
}

/** Etiqueta de período `'YYYY-MM'`. */
export function etiquetaPeriodo(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/** Período siguiente al dado (envuelve diciembre→enero). */
export function periodoSiguiente(anio: number, mes: number): PeriodoFiscal {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

/** Período anterior al dado (envuelve enero→diciembre). */
export function periodoAnterior(anio: number, mes: number): PeriodoFiscal {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

/** Fecha límite de la declaración mensual del período `anio-mes`: día 15 del mes SIGUIENTE. */
function vencimientoMensual(anio: number, mes: number): string {
  const v = periodoSiguiente(anio, mes);
  return `${v.anio}-${String(v.mes).padStart(2, '0')}-${String(DIA_VENCIMIENTO_DEFECTO).padStart(2, '0')}`;
}

/** Días enteros entre dos fechas civiles (`a − b`); positivo si `a` es posterior a `b`. */
export function diferenciaDias(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
