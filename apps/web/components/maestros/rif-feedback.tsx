import type { ResultadoRif } from '@contave/shared';

/** Mensaje accionable por motivo de RIF inválido (caso 16: bloqueo con explicación). */
const MENSAJE: Record<NonNullable<ResultadoRif['motivo']>, string> = {
  formato_invalido: 'Formato esperado: [VEJPG]-XXXXXXXX-X',
  tipo_invalido: 'El tipo debe ser V, E, J, P o G',
  digito_verificador: 'El dígito verificador no concuerda',
};

interface Props {
  /** Resultado de `validarRif` o `null` cuando el campo está vacío. */
  resultado: ResultadoRif | null;
}

/**
 * Retroalimentación en vivo de la validación de RIF en el alta de terceros (doc 06 M1: "+ nuevo
 * inline con validación de RIF"; caso 16). Presentacional puro → testeable con props.
 */
export function RifFeedback({ resultado }: Props): React.JSX.Element | null {
  if (resultado === null) {
    return null;
  }
  if (resultado.valido) {
    return (
      <span className="text-xs text-emerald-600 dark:text-emerald-400">
        RIF válido · {resultado.normalizado}
      </span>
    );
  }
  return (
    <span role="alert" className="text-xs text-destructive">
      {resultado.motivo ? MENSAJE[resultado.motivo] : 'RIF inválido'}
    </span>
  );
}
