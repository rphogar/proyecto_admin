/**
 * Derivación pura del calendario de obligaciones tributarias por empresa (P16/P21, docs/02 §10, docs/06
 * M11). Sin IO ni dependencias de Nest → se prueba en unidad. Generaliza el "semáforo fiscal" del
 * dashboard (P14) al portal del contador: una fila por (empresa, tipo, período) con su fecha límite,
 * días restantes y estado (PRESENTADA / PENDIENTE) tomado de las declaraciones realmente presentadas.
 *
 * Alcance v1 (lo que el sistema puede verificar hoy contra `tax_returns`): IVA mensual para todos y
 * IGTF percibido para Sujetos Pasivos Especiales designados. La **fecha límite de los SPE se toma del
 * calendario por dígito terminal del RIF**, que entra como datos por providencia anual (regla 17): el
 * servicio carga el parámetro `CALENDARIO_SPE` y lo inyecta aquí; si no hay entrada vigente se cae a la
 * regla ordinaria (día 15 del mes siguiente). El resto del calendario (retenciones, ISLR, ISAE,
 * parafiscales) se incorpora a medida que el sistema pueda verificarlo contra datos.
 *
 * TODO-TRIBUTARISTA: validar las fechas del calendario SPE importado contra la providencia vigente y la
 * cadencia de los anticipos (quincenal/semanal) antes de producción.
 */

/** Día del mes siguiente en que vence la declaración mensual del contribuyente ordinario. */
const DIA_VENCIMIENTO_DEFECTO = 15;

/**
 * Entrada del calendario SPE publicado por providencia: para un dígito terminal de RIF, un tipo de
 * obligación y un período fiscal, la fecha límite (Caracas) de presentación/pago. Importado como datos
 * (regla 17), nunca hardcode.
 */
export interface EntradaCalendarioSpe {
  /** Último dígito del RIF ('0'..'9'). */
  readonly terminalRif: string;
  /** IVA | IGTF | RET_IVA | ANTICIPO_IVA | ANTICIPO_ISLR | … */
  readonly tipo: string;
  readonly periodoAnio: number;
  readonly periodoMes: number;
  /** Fracción (quincena/semana) para anticipos; ausente/0 para obligaciones mensuales. */
  readonly subperiodo?: number;
  /** Fecha límite `YYYY-MM-DD` (hora de Caracas). */
  readonly fechaLimite: string;
}

export type CalendarioSpe = ReadonlyArray<EntradaCalendarioSpe>;

/** Último dígito del RIF (dígito terminal con que el SENIAT organiza el calendario SPE), o null. */
export function terminalRif(rif: string): string | null {
  const digitos = rif.replace(/[^0-9]/g, '');
  return digitos.length === 0 ? null : digitos[digitos.length - 1]!;
}

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
  calendario: CalendarioSpe = [],
): ObligacionPortal[] {
  const tipos: TipoObligacion[] = empresa.spe ? ['IVA', 'IGTF'] : ['IVA'];
  const terminal = empresa.spe ? terminalRif(empresa.rif) : null;
  const obligaciones: ObligacionPortal[] = [];
  for (const p of periodos) {
    for (const tipo of tipos) {
      // SPE: fecha límite del calendario por terminal de RIF (datos por providencia); si no hay
      // entrada vigente, se cae a la regla ordinaria (día 15 del mes siguiente).
      const fechaLimite =
        fechaCalendarioSpe(calendario, terminal, tipo, p) ?? vencimientoMensual(p.anio, p.mes);
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

/** Busca la fecha límite del calendario SPE para (terminal, tipo, período mensual); null si no hay. */
function fechaCalendarioSpe(
  calendario: CalendarioSpe,
  terminal: string | null,
  tipo: string,
  p: PeriodoFiscal,
): string | null {
  if (terminal === null) return null;
  const e = calendario.find(
    (x) =>
      x.terminalRif === terminal &&
      x.tipo === tipo &&
      x.periodoAnio === p.anio &&
      x.periodoMes === p.mes &&
      (x.subperiodo === undefined || x.subperiodo === 0),
  );
  return e?.fechaLimite ?? null;
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
