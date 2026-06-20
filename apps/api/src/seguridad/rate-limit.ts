/**
 * Limitador de tasa por ventana deslizante (docs/05 §6: rate limiting). Núcleo PURO y
 * determinista: el instante se inyecta en cada llamada, de modo que la lógica se prueba sin
 * relojes reales ni timers. El estado vive en memoria por proceso (clave → marcas de tiempo);
 * en despliegue multi-instancia el backend se reemplaza por Redis conservando esta interfaz.
 *
 * Ventana DESLIZANTE (no fija): cuenta los eventos en los últimos `ventanaMs` ms exactos, así
 * evita el pico de borde de las ventanas fijas (2× el límite alrededor del cambio de ventana).
 */
export interface ResultadoLimite {
  /** ¿Se admite el evento? */
  permitido: boolean;
  /** Eventos restantes en la ventana actual (0 si se bloqueó). */
  restante: number;
  /** ms hasta que se libere al menos un cupo (para la cabecera `Retry-After`). */
  reintentarEnMs: number;
}

export interface OpcionesLimitador {
  /** Máximo de eventos admitidos por ventana. */
  limite: number;
  /** Tamaño de la ventana en ms. */
  ventanaMs: number;
}

export class LimitadorVentanaDeslizante {
  private readonly limite: number;
  private readonly ventanaMs: number;
  /** clave → marcas de tiempo (ms) de los eventos admitidos dentro de la ventana. */
  private readonly registros = new Map<string, number[]>();

  constructor(opts: OpcionesLimitador) {
    if (opts.limite <= 0 || opts.ventanaMs <= 0) {
      throw new Error('limite y ventanaMs deben ser positivos');
    }
    this.limite = opts.limite;
    this.ventanaMs = opts.ventanaMs;
  }

  /**
   * Registra un intento para `clave` en `ahoraMs`. Si hay cupo, lo consume y devuelve
   * `permitido: true`; si no, NO consume cupo y devuelve cuándo se liberará el siguiente.
   */
  consumir(clave: string, ahoraMs: number): ResultadoLimite {
    const desde = ahoraMs - this.ventanaMs;
    const previas = this.registros.get(clave) ?? [];
    // Conservar solo las marcas dentro de la ventana deslizante.
    const vigentes = previas.filter((t) => t > desde);

    if (vigentes.length >= this.limite) {
      // La marca más antigua marca cuándo sale de la ventana y se libera un cupo.
      const masAntigua = vigentes[0]!;
      const reintentarEnMs = Math.max(0, masAntigua + this.ventanaMs - ahoraMs);
      this.registros.set(clave, vigentes);
      return { permitido: false, restante: 0, reintentarEnMs };
    }

    vigentes.push(ahoraMs);
    this.registros.set(clave, vigentes);
    return { permitido: true, restante: this.limite - vigentes.length, reintentarEnMs: 0 };
  }

  /** Elimina las claves sin eventos vigentes (limpieza periódica para acotar memoria). */
  podar(ahoraMs: number): void {
    const desde = ahoraMs - this.ventanaMs;
    for (const [clave, marcas] of this.registros) {
      const vigentes = marcas.filter((t) => t > desde);
      if (vigentes.length === 0) {
        this.registros.delete(clave);
      } else {
        this.registros.set(clave, vigentes);
      }
    }
  }

  /** Olvida el estado de una clave (p. ej. tras login exitoso para el limitador de auth). */
  reiniciar(clave: string): void {
    this.registros.delete(clave);
  }
}
