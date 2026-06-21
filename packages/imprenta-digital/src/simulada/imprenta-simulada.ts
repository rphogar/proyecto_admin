import type {
  ImprentaDigital,
  ResultadoConservacion,
  ResultadoControlDigital,
  ResultadoEntrega,
  SolicitudConservacion,
  SolicitudControlDigital,
  SolicitudEntrega,
} from '../adapter/imprenta-digital';

/**
 * Adapter SIMULADO: una imprenta digital en memoria. Es el adapter por defecto en CI (sin proveedor
 * real) y en el SaaS hasta que haya una imprenta digital autorizada integrada. Mantiene un contador
 * consecutivo de números de control digitales y registra entregas/conservaciones, de modo que las
 * pruebas del ciclo emisión→asignación de control→entrega no dependan de un servicio externo.
 *
 * TODO-TRIBUTARISTA: el formato del número de control digital (`PREFIJO-00000001`) es provisional; la
 * imprenta autorizada definirá la estructura real. Aislado tras el adapter, no afecta al resto.
 *
 * Modos de fallo para tests de contingencia:
 *  - `caer()`     → toda operación devuelve REINTENTABLE (proveedor no disponible).
 *  - `rechazar()` → devuelve PERMANENTE (rechazo del proveedor).
 *  - `reparar()`  → vuelve a operar normalmente.
 */
export class ImprentaDigitalSimulada implements ImprentaDigital {
  private contador: number;
  private modo: 'OK' | 'CAIDA' | 'RECHAZO' = 'OK';
  private readonly prefijo: string;
  /** Registro en memoria de lo asignado/entregado/conservado (inspección en tests). */
  readonly controlesAsignados: { numeroControl: string; solicitud: SolicitudControlDigital }[] = [];
  readonly entregas: SolicitudEntrega[] = [];
  readonly conservaciones: SolicitudConservacion[] = [];

  constructor(opciones?: { prefijo?: string; desde?: number }) {
    this.prefijo = opciones?.prefijo ?? 'DIG';
    this.contador = opciones?.desde ?? 0;
  }

  caer(): void {
    this.modo = 'CAIDA';
  }
  rechazar(): void {
    this.modo = 'RECHAZO';
  }
  reparar(): void {
    this.modo = 'OK';
  }

  async asignarControl(solicitud: SolicitudControlDigital): Promise<ResultadoControlDigital> {
    if (this.modo === 'CAIDA') return { tipo: 'REINTENTABLE', motivo: 'Imprenta digital simulada no disponible (caída)' };
    if (this.modo === 'RECHAZO') return { tipo: 'PERMANENTE', motivo: 'Imprenta digital simulada: solicitud rechazada' };
    this.contador += 1;
    const numeroControl = `${this.prefijo}-${String(this.contador).padStart(8, '0')}`;
    this.controlesAsignados.push({ numeroControl, solicitud });
    return {
      tipo: 'ASIGNADO',
      numeroControl,
      acuse: { numeroControl, asignadoEn: new Date().toISOString(), hashContenido: solicitud.hashContenido },
    };
  }

  async entregar(solicitud: SolicitudEntrega): Promise<ResultadoEntrega> {
    if (this.modo === 'CAIDA') return { tipo: 'REINTENTABLE', motivo: 'Imprenta digital simulada no disponible (caída)' };
    if (this.modo === 'RECHAZO') return { tipo: 'PERMANENTE', motivo: 'Imprenta digital simulada: entrega rechazada' };
    if (solicitud.destinatario.canal === 'EMAIL' && !solicitud.destinatario.direccion.includes('@')) {
      return { tipo: 'PERMANENTE', motivo: `Correo de entrega inválido: ${solicitud.destinatario.direccion}` };
    }
    this.entregas.push(solicitud);
    const entregadoEn = new Date().toISOString();
    return {
      tipo: 'ENTREGADO',
      entregadoEn,
      acuse: {
        numeroControl: solicitud.documento.numeroControl,
        canal: solicitud.destinatario.canal,
        direccion: solicitud.destinatario.direccion,
        identificador: solicitud.documento.control.identificador,
        entregadoEn,
      },
    };
  }

  async conservar(solicitud: SolicitudConservacion): Promise<ResultadoConservacion> {
    if (this.modo === 'CAIDA') return { tipo: 'REINTENTABLE', motivo: 'Imprenta digital simulada no disponible (caída)' };
    if (this.modo === 'RECHAZO') return { tipo: 'PERMANENTE', motivo: 'Imprenta digital simulada: conservación rechazada' };
    this.conservaciones.push(solicitud);
    return {
      tipo: 'CONSERVADO',
      referencia: `CONS-${solicitud.documento.numeroControl}`,
      acuse: { numeroControl: solicitud.documento.numeroControl, retencionAnios: solicitud.retencionAnios },
    };
  }
}
