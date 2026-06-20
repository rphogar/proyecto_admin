/**
 * Fixtures de la empresa DEMO (solo desarrollo). UUIDs fijos para que el seed (`db:seed-demo`)
 * y el endpoint `GET /dev/sesion` coincidan, y para que la guía de pruebas pueda referirlos.
 *
 * NO usar en producción: el seed se ejecuta a mano en dev; el módulo `dev` no se monta cuando
 * `NODE_ENV === 'production'`.
 */
export const DEMO = {
  tenant: {
    id: '00000000-0000-0000-0000-0000000000a1',
    nombre: 'Grupo Demo',
    slug: 'demo',
  },
  usuario: {
    id: '00000000-0000-0000-0000-0000000000b1',
    email: 'demo@contave.test',
    nombre: 'Usuario Demo',
    role: 'owner',
  },
  empresa: {
    id: '00000000-0000-0000-0000-0000000000c1',
    rif: 'J-12345678-9',
    razonSocial: 'Distribuidora Demo, C.A.',
    direccionFiscal: 'Av. Principal, Caracas',
    tipoContribuyente: 'ORDINARIO',
  },
  /** Segunda empresa: Sujeto Pasivo Especial (SPE) para probar IGTF, anticipos y calendario SPE (P21). */
  empresaSpe: {
    id: '00000000-0000-0000-0000-0000000000c2',
    rif: 'J-13579246-8',
    razonSocial: 'Especial Demo, C.A.',
    direccionFiscal: 'Torre Empresarial, Caracas',
    tipoContribuyente: 'ESPECIAL',
    /** Dígito terminal del RIF con que el SENIAT organiza el calendario SPE. */
    terminalRif: '8',
  },
} as const;
