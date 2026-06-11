// @contave/shared — tipos y utilidades compartidas: dinero (Money sobre Decimal),
// fechas America/Caracas y validación de identificadores fiscales (RIF).
// Ver CLAUDE.md (reglas 1–3, 15) y docs/03 §4.

export const SHARED_PACKAGE = '@contave/shared';

export { Decimal, REDONDEO_FISCAL } from './dinero/decimal-config';
export { Money } from './dinero/money';
export type { CodigoMoneda, MoneyInput, Peso } from './dinero/money';

export {
  ZONA_CARACAS,
  fechaFiscal,
  periodoFiscal,
  limitesPeriodoMensual,
  instanteCaracasISO,
  caracasAUtc,
} from './fechas/caracas';
export type { InstanteUtc } from './fechas/caracas';

export { validarRif, esRifValido, calcularDigitoVerificadorRif } from './identificadores/rif';
export type { TipoRif, MotivoRifInvalido, ResultadoRif } from './identificadores/rif';
