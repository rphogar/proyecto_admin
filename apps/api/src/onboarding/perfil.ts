/**
 * Re-exporta la inferencia de perfil tributario del motor fiscal puro (`@contave/fiscal-engine`,
 * docs/02 §1) para que el módulo de onboarding tenga un único punto de importación. La lógica
 * tributaria vive en el motor (testeada con tests puros); aquí solo se reexporta.
 */
export {
  inferirPerfilTributario,
  type PerfilInput,
  type PerfilInferido,
  type TipoContribuyente,
  type FormaJuridica,
} from '@contave/fiscal-engine';
