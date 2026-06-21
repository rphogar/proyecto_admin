import type {
  ImpresoraFiscal,
  RangoMemoria,
  ResultadoImpresion,
  ResultadoReporte,
} from '../../adapter/impresora-fiscal';
import type { ComandoFiscal } from '../../mapeo/comando-fiscal';
import { construirTramas } from './protocolo-hka';
import type { RespuestaTrama, TramaHka, TransporteSerie } from './transporte-serie';

/**
 * Driver de The Factory HKA (P23, primera marca soportada). Implementa `ImpresoraFiscal` traduciendo
 * los comandos abstractos a tramas del protocolo (`protocolo-hka.ts`) y enviándolas por el transporte
 * inyectado. NO abre el puerto serie: eso lo hace el agente local que provee el `TransporteSerie`.
 *
 * TODO-HARDWARE: la clasificación de códigos de estado en REINTENTABLE vs PERMANENTE y la extracción
 * de número/control fiscal del acuse de cierre deben afinarse contra la tabla real del fabricante.
 */

/** Códigos de estado del hardware que se consideran recuperables (contingencia → reintento). */
const CODIGOS_REINTENTABLES = new Set<string>([
  'SIN_PAPEL',
  'OCUPADA',
  'TAPA_ABIERTA',
  'NO_RESPONDE',
  'TRANSPORTE',
]);

export class DriverTheFactoryHka implements ImpresoraFiscal {
  constructor(private readonly transporte: TransporteSerie) {}

  async imprimirDocumento(comandos: ComandoFiscal[]): Promise<ResultadoImpresion> {
    const tramas = construirTramas(comandos);
    let ultima: RespuestaTrama | undefined;
    for (const trama of tramas) {
      const respuesta = await this.enviarSeguro(trama);
      if (respuesta === null) {
        return { tipo: 'REINTENTABLE', motivo: 'Fallo de transporte con la máquina fiscal' };
      }
      if (!respuesta.ok) {
        return this.clasificarFallo(respuesta);
      }
      ultima = respuesta;
    }
    const numeroFiscal = typeof ultima?.datos?.numeroFiscal === 'string' ? ultima.datos.numeroFiscal : '';
    const controlFiscal = typeof ultima?.datos?.controlFiscal === 'string' ? ultima.datos.controlFiscal : '';
    if (numeroFiscal === '' || controlFiscal === '') {
      // La máquina no devolvió la numeración fiscal del cierre: tratable como recuperable.
      return { tipo: 'REINTENTABLE', motivo: 'La máquina no devolvió número/control fiscal en el cierre' };
    }
    return { tipo: 'IMPRESO', numeroFiscal, controlFiscal, acuse: ultima?.datos ?? {} };
  }

  async reporteX(): Promise<ResultadoReporte> {
    return this.reporte('X', { comando: 'REPORTE_X', cuerpo: '' });
  }

  async reporteZ(): Promise<ResultadoReporte> {
    return this.reporte('Z', { comando: 'REPORTE_Z', cuerpo: '' });
  }

  async leerMemoriaFiscal(rango?: RangoMemoria): Promise<ResultadoReporte> {
    return this.reporte('MEMORIA', { comando: 'LEER_MEMORIA', cuerpo: serializarRango(rango) });
  }

  private async reporte(clase: 'X' | 'Z' | 'MEMORIA', trama: TramaHka): Promise<ResultadoReporte> {
    const respuesta = await this.enviarSeguro(trama);
    if (respuesta === null) {
      return { tipo: 'REINTENTABLE', motivo: 'Fallo de transporte con la máquina fiscal' };
    }
    if (!respuesta.ok) {
      const fallo = this.clasificarFallo(respuesta);
      return fallo.tipo === 'REINTENTABLE'
        ? { tipo: 'REINTENTABLE', motivo: fallo.motivo }
        : { tipo: 'PERMANENTE', motivo: fallo.motivo };
    }
    return {
      tipo: 'OK',
      reporte: {
        clase,
        emitidoEn: typeof respuesta.datos?.emitidoEn === 'string' ? respuesta.datos.emitidoEn : new Date().toISOString(),
        datos: respuesta.datos ?? {},
      },
    };
  }

  private async enviarSeguro(trama: TramaHka): Promise<RespuestaTrama | null> {
    try {
      return await this.transporte.enviar(trama);
    } catch {
      return null;
    }
  }

  private clasificarFallo(respuesta: RespuestaTrama): { tipo: 'REINTENTABLE' | 'PERMANENTE'; motivo: string } {
    const motivo = `Máquina fiscal devolvió estado ${respuesta.codigo}`;
    return CODIGOS_REINTENTABLES.has(respuesta.codigo) ? { tipo: 'REINTENTABLE', motivo } : { tipo: 'PERMANENTE', motivo };
  }
}

function serializarRango(rango?: RangoMemoria): string {
  if (rango === undefined) return '';
  if (rango.desdeZ !== undefined || rango.hastaZ !== undefined) {
    return `Z|${rango.desdeZ ?? ''}|${rango.hastaZ ?? ''}`;
  }
  return `F|${rango.desdeFecha ?? ''}|${rango.hastaFecha ?? ''}`;
}
