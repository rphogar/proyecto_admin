import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * Adapter de remisión de registros de facturación al SENIAT (P17/P25, Providencia 121 §6.3 req. 2:
 * remisión "continua, segura, correcta, íntegra, automática, consecutiva, inmediata y fehaciente").
 *
 * **Punto de extensión ÚNICO del módulo desacoplado** (docs/05 §5): la cola, los reintentos con
 * backoff, la idempotencia y la observabilidad ya existen; cuando el SENIAT publique el canal técnico
 * solo se implementa esta interfaz contra el servicio real y nada más cambia. La cola NO conoce el
 * formato: serializar al formato exigido, firmar y enviar son responsabilidad del adapter.
 *
 * El canal puede ser **síncrono** (`transmitir` devuelve ACUSADO de una vez) o **asíncrono**
 * (`transmitir` devuelve ENVIADO con una referencia, y el acuse se consulta luego con
 * `consultarAcuse`). La cola soporta ambos.
 */

/** Token de inyección del adapter (permite sustituirlo por el real o por un fake en tests). */
export const REMISION_ADAPTER = Symbol('REMISION_ADAPTER');

/**
 * Contexto que la cola entrega al adapter para un intento. El adapter NO consulta la BD: recibe todo
 * lo necesario. `idempotencyKey` es estable por documento y debe viajar al canal del SENIAT como token
 * de deduplicación, de modo que reintentos/reenvíos no dupliquen el registro de facturación.
 */
export interface RegistroParaRemision {
  /** Token de idempotencia estable por documento (dedup en el canal del SENIAT). */
  readonly idempotencyKey: string;
  /** Documento de origen, si la remisión nace de uno (trazabilidad). */
  readonly documentId: string | null;
  /** Snapshot del registro de facturación (formato interno; el adapter lo serializa al formato SENIAT). */
  readonly payload: unknown;
  /** Reintentos ya realizados sobre este ítem (0 en el primer intento). */
  readonly intento: number;
}

/** Resultado de un intento de **envío** (`transmitir`). No lanza: codifica el desenlace. */
export type ResultadoRemision =
  | { tipo: 'ACUSADO'; acuseRef: string; acuse: unknown }
  | { tipo: 'ENVIADO'; refEnvio: string }
  | { tipo: 'REINTENTABLE'; motivo: string }
  | { tipo: 'PERMANENTE'; motivo: string };

/** Resultado de una **consulta de acuse** (`consultarAcuse`) para un envío asíncrono. */
export type ResultadoAcuse =
  | { tipo: 'ACUSADO'; acuseRef: string; acuse: unknown }
  | { tipo: 'PENDIENTE'; motivo?: string }
  | { tipo: 'PERMANENTE'; motivo: string };

export interface RemisionAdapter {
  /** Intenta remitir el registro. Devuelve ACUSADO (canal síncrono) o ENVIADO (acuse asíncrono). */
  transmitir(registro: RegistroParaRemision): Promise<ResultadoRemision>;
  /**
   * Consulta el acuse de un envío aceptado de forma asíncrona (`refEnvio` que devolvió `transmitir`).
   * **Opcional**: los canales síncronos (acuse inmediato en `transmitir`) no lo implementan.
   */
  consultarAcuse?(refEnvio: string, registro: RegistroParaRemision): Promise<ResultadoAcuse>;
}

/**
 * Stub por defecto: reporta el canal del SENIAT como **no disponible** (REINTENTABLE), de modo que los
 * ítems permanecen en cola reintentándose con backoff sin marcarse como error permanente. Refleja la
 * realidad regulatoria actual (canal técnico aún no publicado) sin bloquear el flujo de emisión.
 */
@Injectable()
export class StubRemisionAdapter implements RemisionAdapter {
  async transmitir(_registro: RegistroParaRemision): Promise<ResultadoRemision> {
    return {
      tipo: 'REINTENTABLE',
      motivo: 'Canal de remisión SENIAT no disponible (adapter stub; pendiente especificación técnica de la Providencia 121)',
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Adapter de PRUEBA — ejercita el contrato extremo a extremo (NO es el adapter real)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Sobre serializado listo para firmar/enviar. Forma de referencia, NO el formato oficial del SENIAT. */
export interface SobreRemision {
  /** Token de idempotencia que debe acompañar el envío en el canal. */
  readonly idempotencyKey: string;
  /** Cuerpo serializado del registro de facturación. */
  readonly cuerpo: string;
  /** Tipo de contenido del cuerpo. */
  readonly contentType: string;
}

/** Sobre ya firmado, listo para el envío seguro. */
export interface SobreFirmado extends SobreRemision {
  /** Firma del cuerpo (fehaciencia/inalterabilidad). */
  readonly firma: string;
  readonly algoritmoFirma: string;
}

/**
 * Serializa el registro al formato del canal.
 *
 * TODO-SENIAT: el formato EXACTO (XML/JSON, esquema, campos obligatorios, codificación) lo define la
 * especificación técnica de la Providencia 121, **aún no publicada**. Esta serialización es un
 * marcador de referencia para ejercitar el contrato; el adapter real reemplaza SOLO este punto.
 */
function serializarPlaceholder(registro: RegistroParaRemision): SobreRemision {
  // TODO-SENIAT: sustituir por el serializador al formato oficial cuando se publique el esquema.
  return {
    idempotencyKey: registro.idempotencyKey,
    cuerpo: JSON.stringify({ idempotencyKey: registro.idempotencyKey, documentId: registro.documentId, registro: registro.payload }),
    contentType: 'application/json; charset=utf-8 (PLACEHOLDER — pendiente formato SENIAT)',
  };
}

/**
 * Firma electrónicamente el sobre.
 *
 * TODO-SENIAT: el mecanismo de firma (certificado, algoritmo, política de firma) lo define la norma.
 * Aquí se usa un hash determinista solo para ejercitar el contrato; NO es una firma válida.
 */
function firmarPlaceholder(sobre: SobreRemision): SobreFirmado {
  // TODO-SENIAT: sustituir por la firma electrónica conforme a la especificación del canal.
  const firma = createHash('sha256').update(sobre.cuerpo).digest('hex');
  return { ...sobre, firma, algoritmoFirma: 'sha256-PLACEHOLDER' };
}

/**
 * Adapter de **prueba** que demuestra el pipeline completo del adapter real
 * (serializar → firmar → enviar → acuse) sin inventar el formato oficial. Útil en tests e integración
 * para ejercitar el camino ACUSADO/ENVIADO de la cola. Configurable para simular canal síncrono o
 * asíncrono, y fallos transitorios/permanentes.
 *
 * NO usar en producción: hasta que exista la especificación, el provider por defecto es
 * `StubRemisionAdapter` (canal no disponible).
 */
export class RemisionAdapterDePrueba implements RemisionAdapter {
  private readonly asincrono: boolean;
  private readonly enviosVistos = new Set<string>();
  /** Envíos aceptados de forma asíncrona, indexados por `refEnvio`, a la espera de acuse. */
  private readonly pendientesDeAcuse = new Map<string, { idempotencyKey: string; consultas: number }>();
  /** Nº de consultas de acuse antes de devolver ACUSADO (simula latencia del canal asíncrono). */
  private readonly consultasHastaAcuse: number;

  constructor(opciones?: { asincrono?: boolean; consultasHastaAcuse?: number }) {
    this.asincrono = opciones?.asincrono ?? false;
    this.consultasHastaAcuse = opciones?.consultasHastaAcuse ?? 1;
  }

  async transmitir(registro: RegistroParaRemision): Promise<ResultadoRemision> {
    const sobre = serializarPlaceholder(registro);
    const firmado = firmarPlaceholder(sobre);
    // Idempotencia del canal: un mismo idempotencyKey no se procesa dos veces como envío nuevo.
    const reenvio = this.enviosVistos.has(registro.idempotencyKey);
    this.enviosVistos.add(registro.idempotencyKey);

    if (this.asincrono) {
      const refEnvio = `ENV-${registro.idempotencyKey}`;
      if (!this.pendientesDeAcuse.has(refEnvio)) {
        this.pendientesDeAcuse.set(refEnvio, { idempotencyKey: registro.idempotencyKey, consultas: 0 });
      }
      return { tipo: 'ENVIADO', refEnvio };
    }
    return {
      tipo: 'ACUSADO',
      acuseRef: `AC-${registro.idempotencyKey}`,
      acuse: { recibido: true, reenvio, firma: firmado.firma, algoritmoFirma: firmado.algoritmoFirma },
    };
  }

  async consultarAcuse(refEnvio: string, _registro: RegistroParaRemision): Promise<ResultadoAcuse> {
    const estado = this.pendientesDeAcuse.get(refEnvio);
    if (estado === undefined) return { tipo: 'PERMANENTE', motivo: `refEnvio desconocido: ${refEnvio}` };
    estado.consultas += 1;
    if (estado.consultas < this.consultasHastaAcuse) {
      return { tipo: 'PENDIENTE', motivo: 'acuse aún no disponible en el canal' };
    }
    this.pendientesDeAcuse.delete(refEnvio);
    return { tipo: 'ACUSADO', acuseRef: `AC-${estado.idempotencyKey}`, acuse: { recibido: true, via: refEnvio } };
  }
}

/** Genera un token de idempotencia para registros sin documento de origen. */
export function generarIdempotencyKey(): string {
  return randomUUID();
}
