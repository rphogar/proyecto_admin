/**
 * Bloqueo temporal de login tras N intentos fallidos (P27, docs/05 §6) — complementa el
 * rate-limit por endpoint con un lockout por CUENTA/origen para frenar fuerza bruta dirigida.
 * Núcleo PURO y determinista (el instante se inyecta), al estilo de `rate-limit.ts`: el estado
 * vive en memoria por proceso; en multi-instancia el backend se reemplaza por Redis conservando
 * esta interfaz.
 *
 * Semántica: se cuentan los fallos dentro de `ventanaMs`; al alcanzar `maxIntentos` la clave queda
 * bloqueada `bloqueoMs`. Un login exitoso reinicia el contador (`reiniciar`). Las marcas viejas
 * fuera de la ventana no cuentan (no se acumulan fallos de hace horas).
 */
export interface OpcionesBloqueo {
  /** Fallos permitidos dentro de la ventana antes de bloquear. */
  maxIntentos: number;
  /** Ventana en la que se cuentan los fallos (ms). */
  ventanaMs: number;
  /** Duración del bloqueo una vez alcanzado el máximo (ms). */
  bloqueoMs: number;
}

export const OPCIONES_BLOQUEO_DEFAULT: OpcionesBloqueo = {
  maxIntentos: 5,
  ventanaMs: 15 * 60_000,
  bloqueoMs: 15 * 60_000,
};

interface EstadoClave {
  /** Marcas de tiempo (ms) de los fallos recientes. */
  fallos: number[];
  /** Instante (ms) hasta el que la clave está bloqueada, o 0 si no lo está. */
  bloqueadoHasta: number;
}

export interface ResultadoBloqueo {
  /** ¿La clave está bloqueada ahora mismo? */
  bloqueado: boolean;
  /** ms restantes de bloqueo (0 si no está bloqueado). */
  restanteMs: number;
}

export class ControlBloqueoLogin {
  private readonly opts: OpcionesBloqueo;
  private readonly estados = new Map<string, EstadoClave>();

  constructor(opts: OpcionesBloqueo = OPCIONES_BLOQUEO_DEFAULT) {
    if (opts.maxIntentos <= 0 || opts.ventanaMs <= 0 || opts.bloqueoMs <= 0) {
      throw new Error('maxIntentos, ventanaMs y bloqueoMs deben ser positivos');
    }
    this.opts = opts;
  }

  /** ¿Está la clave bloqueada en `ahoraMs`? No muta estado salvo limpiar un bloqueo vencido. */
  estado(clave: string, ahoraMs: number): ResultadoBloqueo {
    const e = this.estados.get(clave);
    if (e === undefined || e.bloqueadoHasta <= ahoraMs) {
      return { bloqueado: false, restanteMs: 0 };
    }
    return { bloqueado: true, restanteMs: e.bloqueadoHasta - ahoraMs };
  }

  /**
   * Registra un fallo de autenticación para `clave`. Devuelve el estado de bloqueo resultante:
   * si con este fallo se alcanza el máximo dentro de la ventana, la clave queda bloqueada.
   */
  registrarFallo(clave: string, ahoraMs: number): ResultadoBloqueo {
    const desde = ahoraMs - this.opts.ventanaMs;
    const previo = this.estados.get(clave);
    const fallos = (previo?.fallos ?? []).filter((t) => t > desde);
    fallos.push(ahoraMs);

    let bloqueadoHasta = previo?.bloqueadoHasta ?? 0;
    if (fallos.length >= this.opts.maxIntentos) {
      bloqueadoHasta = ahoraMs + this.opts.bloqueoMs;
    }
    this.estados.set(clave, { fallos, bloqueadoHasta });
    return this.estado(clave, ahoraMs);
  }

  /** Olvida el estado de una clave (login exitoso o reset de contraseña). */
  reiniciar(clave: string): void {
    this.estados.delete(clave);
  }
}
