import { Decimal } from '@contave/shared';
import type { ComandoFiscal, CodigoAlicuotaFiscal } from '../../mapeo/comando-fiscal';
import type { TramaHka } from './transporte-serie';

/**
 * Traducción de comandos fiscales abstractos al juego de comandos de The Factory HKA (familia SVF/PnP).
 *
 * TODO-HARDWARE: los prefijos de comando (p. ej. `@`/`i`/`I`/`3`/`101`/`199`), la codificación de
 * octetos, el STX/ETX, el byte de control (BCC/checksum) y la tabla de respuestas reales deben
 * verificarse contra el manual del fabricante y el equipo físico. Aquí se modela la ESTRUCTURA de la
 * traducción (qué trama por comando, en qué orden, con importes a 2 decimales) de forma pura y
 * testeable; el agente local sustituye/ajusta la serialización real al cablear el puerto.
 */

const DEC2 = 2;

/** Importe fiscal a 2 decimales sin separador (centésimos), como exige el protocolo HKA. */
function montoHka(valor: string): string {
  return new Decimal(valor).toDecimalPlaces(DEC2).toFixed(DEC2).replace('.', '');
}

/**
 * Ranura de impuesto del hardware por código de alícuota.
 * TODO-TRIBUTARISTA: la correspondencia código→ranura depende de la parametrización fiscal cargada en
 * cada máquina (orden de tasas en memoria fiscal). Validar con el equipo y la tabla vigente.
 */
function ranuraImpuesto(codigo: CodigoAlicuotaFiscal): string {
  switch (codigo) {
    case 'EXENTO':
    case 'EXONERADO':
    case 'EXPORTACION':
      return 'E'; // exento/no gravado
    case 'REDUCIDA':
      return '!'; // tasa reducida (ranura 2)
    case 'ADICIONAL':
      return '"'; // tasa adicional (ranura 3)
    case 'GENERAL':
    default:
      return ' '; // tasa general (ranura 1)
  }
}

/** Construye la(s) trama(s) HKA de un comando abstracto. */
export function tramasDeComando(comando: ComandoFiscal): TramaHka[] {
  switch (comando.clase) {
    case 'ABRIR_DOC': {
      // Documento personalizado: si hay adquirente identificado se cargan sus datos antes de abrir.
      const tramas: TramaHka[] = [];
      if (comando.adquirente.tipo === 'IDENTIFICADO') {
        tramas.push({ comando: 'CLIENTE_RIF', cuerpo: comando.adquirente.rif });
        tramas.push({ comando: 'CLIENTE_NOMBRE', cuerpo: comando.adquirente.nombre });
      }
      if (comando.afectado !== undefined && comando.afectado !== null) {
        tramas.push({ comando: 'DOC_AFECTADO', cuerpo: `${comando.afectado.numeroFiscal}|${comando.afectado.fecha}` });
      }
      tramas.push({ comando: `ABRIR_${comando.tipoDoc}`, cuerpo: comando.adquirente.tipo });
      return tramas;
    }
    case 'LINEA':
      return [
        {
          comando: 'LINEA',
          cuerpo: `${ranuraImpuesto(comando.alicuotaCodigo)}${montoHka(comando.precioUnitario)}|${new Decimal(
            comando.cantidad,
          ).toFixed()}|${comando.descripcion}`,
        },
      ];
    case 'DESCUENTO_LINEA':
      return [{ comando: 'DESCUENTO', cuerpo: montoHka(comando.monto) }];
    case 'SUBTOTAL':
      return [{ comando: 'SUBTOTAL', cuerpo: '' }];
    case 'MEDIO_PAGO':
      return [{ comando: 'PAGO', cuerpo: `${comando.tipo}|${montoHka(comando.monto)}|${comando.descripcion}` }];
    case 'CERRAR_DOC':
      return [{ comando: 'CERRAR', cuerpo: '' }];
    case 'TEXTO_NO_FISCAL':
      return [{ comando: 'TEXTO', cuerpo: comando.texto }];
    default: {
      const _exhaustivo: never = comando;
      return _exhaustivo;
    }
  }
}

/** Aplana una secuencia de comandos abstractos a la secuencia de tramas HKA a enviar. */
export function construirTramas(comandos: ComandoFiscal[]): TramaHka[] {
  return comandos.flatMap(tramasDeComando);
}
