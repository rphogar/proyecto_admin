import type {
  ImpresoraFiscal,
  RangoMemoria,
  ReporteFiscal,
  ResultadoImpresion,
  ResultadoReporte,
} from '../adapter/impresora-fiscal';
import type { ComandoFiscal } from '../mapeo/comando-fiscal';

/**
 * Adapter SIMULADO: una máquina fiscal en memoria. Es el adapter por defecto en CI (sin hardware) y en
 * el SaaS hasta que haya equipo real. Mantiene un contador fiscal consecutivo y un contador de cierres
 * Z, de modo que las pruebas de mapeo, atomicidad y contingencia no dependan del hardware.
 *
 * Modos de fallo para tests de contingencia:
 *  - `caer()`  → toda impresión/reporte devuelve REINTENTABLE (impresora caída).
 *  - `rechazar()` → devuelve PERMANENTE (rechazo fiscal / documento mal formado).
 *  - `reparar()` → vuelve a operar normalmente.
 */
export class ImpresoraFiscalSimulada implements ImpresoraFiscal {
  private contadorFiscal: number;
  private contadorZ = 0;
  private modo: 'OK' | 'CAIDA' | 'RECHAZO' = 'OK';
  private readonly serie: string;
  private readonly documentos: { numeroFiscal: string; controlFiscal: string; comandos: ComandoFiscal[] }[] = [];

  constructor(opciones?: { serie?: string; desde?: number }) {
    this.serie = opciones?.serie ?? 'SIM';
    this.contadorFiscal = opciones?.desde ?? 0;
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

  async imprimirDocumento(comandos: ComandoFiscal[]): Promise<ResultadoImpresion> {
    if (this.modo === 'CAIDA') {
      return { tipo: 'REINTENTABLE', motivo: 'Impresora fiscal simulada en contingencia (caída)' };
    }
    if (this.modo === 'RECHAZO') {
      return { tipo: 'PERMANENTE', motivo: 'Impresora fiscal simulada: documento rechazado' };
    }
    if (!comandos.some((c) => c.clase === 'CERRAR_DOC')) {
      return { tipo: 'PERMANENTE', motivo: 'Secuencia de comandos sin CERRAR_DOC' };
    }
    this.contadorFiscal += 1;
    const numeroFiscal = String(this.contadorFiscal).padStart(8, '0');
    const controlFiscal = `${this.serie}-${numeroFiscal}`;
    this.documentos.push({ numeroFiscal, controlFiscal, comandos });
    return {
      tipo: 'IMPRESO',
      numeroFiscal,
      controlFiscal,
      acuse: { numeroFiscal, controlFiscal, impresoEn: new Date().toISOString() },
    };
  }

  async reporteX(): Promise<ResultadoReporte> {
    return this.reporte({
      clase: 'X',
      emitidoEn: new Date().toISOString(),
      datos: { ultimoNumeroFiscal: this.contadorFiscal, cierresZ: this.contadorZ },
    });
  }

  async reporteZ(): Promise<ResultadoReporte> {
    if (this.modo === 'OK') this.contadorZ += 1;
    return this.reporte({
      clase: 'Z',
      emitidoEn: new Date().toISOString(),
      datos: { numeroZ: this.contadorZ, ultimoNumeroFiscal: this.contadorFiscal },
    });
  }

  async leerMemoriaFiscal(rango?: RangoMemoria): Promise<ResultadoReporte> {
    return this.reporte({
      clase: 'MEMORIA',
      emitidoEn: new Date().toISOString(),
      datos: { rango: rango ?? null, totalCierresZ: this.contadorZ, totalDocumentos: this.documentos.length },
    });
  }

  private reporte(reporte: ReporteFiscal): ResultadoReporte {
    if (this.modo === 'CAIDA') return { tipo: 'REINTENTABLE', motivo: 'Impresora fiscal simulada en contingencia (caída)' };
    if (this.modo === 'RECHAZO') return { tipo: 'PERMANENTE', motivo: 'Impresora fiscal simulada: operación rechazada' };
    return { tipo: 'OK', reporte };
  }
}
