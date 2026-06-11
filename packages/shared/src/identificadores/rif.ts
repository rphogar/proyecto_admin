/**
 * Validación de RIF venezolano (Registro de Información Fiscal) con dígito verificador.
 *
 * Formato: `[VEJPG]-XXXXXXXX-X` — una letra de tipo, 8 dígitos base y 1 dígito verificador.
 * Se usa en P5/P6 para exigir RIF válido antes de emitir documentos (caso 16 del doc 07:
 * "RIF inválido → bloqueo con explicación").
 *
 * El algoritmo del dígito verificador es público y determinista (módulo 11 ponderado),
 * por lo que NO requiere `// TODO-TRIBUTARISTA`.
 */

/** Tipos de RIF soportados y su valor en el algoritmo. */
const VALOR_LETRA = { V: 1, E: 2, J: 3, P: 4, G: 5 } as const;

/** Pesos del módulo 11 para los 8 dígitos base. */
const FACTORES = [3, 2, 7, 6, 5, 4, 3, 2] as const;

export type TipoRif = keyof typeof VALOR_LETRA;

export type MotivoRifInvalido = 'formato_invalido' | 'tipo_invalido' | 'digito_verificador';

export interface ResultadoRif {
  valido: boolean;
  /** Presente solo cuando `valido === false`. */
  motivo?: MotivoRifInvalido;
  /** Forma canónica `V-XXXXXXXX-X`, presente solo cuando `valido === true`. */
  normalizado?: string;
}

function esTipoRif(letra: string): letra is TipoRif {
  return Object.prototype.hasOwnProperty.call(VALOR_LETRA, letra);
}

/**
 * Calcula el dígito verificador (0–9) de un RIF a partir del tipo y los 8 dígitos base.
 * Útil para tests y para generar RIF de prueba.
 *
 * @throws si el tipo no es `[VEJPG]` o si no se pasan exactamente 8 dígitos.
 */
export function calcularDigitoVerificadorRif(tipo: string, ochoDigitos: string): number {
  const t = tipo.trim().toUpperCase();
  if (!esTipoRif(t)) {
    throw new Error(`Tipo de RIF inválido: ${tipo}`);
  }
  if (!/^\d{8}$/.test(ochoDigitos)) {
    throw new Error(`Se requieren exactamente 8 dígitos: ${ochoDigitos}`);
  }
  let suma = VALOR_LETRA[t] * 4;
  FACTORES.forEach((factor, i) => {
    suma += Number(ochoDigitos.charAt(i)) * factor;
  });
  const dv = 11 - (suma % 11);
  return dv >= 10 ? 0 : dv;
}

/**
 * Valida un RIF. Acepta entrada con o sin guiones/espacios y en cualquier capitalización.
 * Devuelve el motivo del rechazo para poder explicarlo en la UI (caso 16 del doc 07).
 */
export function validarRif(rif: unknown): ResultadoRif {
  if (typeof rif !== 'string') {
    return { valido: false, motivo: 'formato_invalido' };
  }
  const limpio = rif.trim().toUpperCase().replace(/[-\s]/g, '');
  if (!/^[A-Z]\d{9}$/.test(limpio)) {
    return { valido: false, motivo: 'formato_invalido' };
  }
  const tipo = limpio.charAt(0);
  if (!esTipoRif(tipo)) {
    return { valido: false, motivo: 'tipo_invalido' };
  }
  const ocho = limpio.slice(1, 9);
  const dvDado = Number(limpio.charAt(9));
  if (calcularDigitoVerificadorRif(tipo, ocho) !== dvDado) {
    return { valido: false, motivo: 'digito_verificador' };
  }
  return { valido: true, normalizado: `${tipo}-${ocho}-${dvDado}` };
}

/** Atajo booleano sobre {@link validarRif}. */
export function esRifValido(rif: unknown): boolean {
  return validarRif(rif).valido;
}
