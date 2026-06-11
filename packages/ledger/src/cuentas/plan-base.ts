import type { DefinicionCuenta } from './cuenta';
import { PlanDeCuentas } from './plan-de-cuentas';

/**
 * Catálogo de cuentas base venezolano (docs/03 §2), preconfigurado para cada empresa.
 * El contador puede extenderlo; no puede borrar cuentas de sistema con movimientos. Todas
 * se marcan `esSistema: true`. Las cuentas totalizadoras (con hijas) NO reciben asientos:
 * el motor solo imputa a hojas (cuentas de movimiento).
 *
 * Las cuentas de divisa llevan `moneda` informativa. Los códigos de diferencial cambiario
 * (`4.7`/`6.7`) se reutilizan como cuentas de redondeo (docs/03 §4.1.5).
 */
export const PLAN_DE_CUENTAS_BASE: ReadonlyArray<DefinicionCuenta> = [
  // 1. ACTIVO
  { codigo: '1', nombre: 'ACTIVO', esSistema: true },
  { codigo: '1.1', nombre: 'Efectivo y equivalentes', esSistema: true },
  { codigo: '1.1.01', nombre: 'Caja Bs', moneda: 'VES', esSistema: true },
  { codigo: '1.1.02', nombre: 'Caja USD efectivo', moneda: 'USD', esSistema: true },
  { codigo: '1.1.03', nombre: 'Bancos nacionales Bs', moneda: 'VES', esSistema: true },
  { codigo: '1.1.04', nombre: 'Bancos nacionales custodia USD', moneda: 'USD', esSistema: true },
  { codigo: '1.1.05', nombre: 'Cuentas en el exterior (Zelle/bancos)', moneda: 'USD', esSistema: true },
  { codigo: '1.1.06', nombre: 'Criptoactivos (USDT y otros)', moneda: 'USDT', esSistema: true },
  { codigo: '1.1.07', nombre: 'Fondos en plataformas (Binance/Zinli/etc.)', moneda: 'USD', esSistema: true },
  { codigo: '1.2', nombre: 'Cuentas por cobrar', esSistema: true },
  { codigo: '1.2.01', nombre: 'Clientes Bs', moneda: 'VES', esSistema: true },
  { codigo: '1.2.02', nombre: 'Clientes divisas', moneda: 'USD', esSistema: true },
  { codigo: '1.2.03', nombre: 'Estimación incobrables', esSistema: true },
  { codigo: '1.2.04', nombre: 'Anticipos a proveedores', esSistema: true },
  { codigo: '1.2.05', nombre: 'Cuentas por cobrar accionistas/relacionadas', esSistema: true },
  { codigo: '1.3', nombre: 'Impuestos a favor', esSistema: true },
  { codigo: '1.3.01', nombre: 'IVA crédito fiscal', esSistema: true },
  { codigo: '1.3.02', nombre: 'Retenciones de IVA soportadas (acumuladas)', esSistema: true },
  { codigo: '1.3.03', nombre: 'Retenciones de ISLR soportadas', esSistema: true },
  { codigo: '1.3.04', nombre: 'Excedentes de IVA', esSistema: true },
  { codigo: '1.3.05', nombre: 'IGTF soportado', esSistema: true },
  { codigo: '1.4', nombre: 'Inventarios', esSistema: true },
  { codigo: '1.5', nombre: 'Activos fijos y depreciación acumulada', esSistema: true },
  { codigo: '1.6', nombre: 'Otros activos', esSistema: true },

  // 2. PASIVO
  { codigo: '2', nombre: 'PASIVO', esSistema: true },
  { codigo: '2.1', nombre: 'Proveedores (Bs / divisas)', esSistema: true },
  { codigo: '2.2', nombre: 'Obligaciones financieras', esSistema: true },
  { codigo: '2.3', nombre: 'Impuestos por pagar', esSistema: true },
  { codigo: '2.3.01', nombre: 'IVA débito fiscal', esSistema: true },
  { codigo: '2.3.02', nombre: 'IVA por pagar (cuota)', esSistema: true },
  { codigo: '2.3.03', nombre: 'Retenciones de IVA por enterar', esSistema: true },
  { codigo: '2.3.04', nombre: 'Retenciones de ISLR por enterar', esSistema: true },
  { codigo: '2.3.05', nombre: 'IGTF percibido por enterar', esSistema: true },
  { codigo: '2.3.06', nombre: 'ISLR por pagar', esSistema: true },
  { codigo: '2.3.07', nombre: 'ISAE municipal por pagar', esSistema: true },
  { codigo: '2.4', nombre: 'Pasivos laborales', esSistema: true },
  { codigo: '2.4.01', nombre: 'Sueldos por pagar', esSistema: true },
  { codigo: '2.4.02', nombre: 'Prestaciones sociales (garantía)', esSistema: true },
  { codigo: '2.4.03', nombre: 'Intereses sobre prestaciones', esSistema: true },
  { codigo: '2.4.04', nombre: 'Utilidades por pagar', esSistema: true },
  { codigo: '2.4.05', nombre: 'Vacaciones/bono vacacional por pagar', esSistema: true },
  { codigo: '2.4.06', nombre: 'IVSS/RPE por enterar', esSistema: true },
  { codigo: '2.4.07', nombre: 'FAOV por enterar', esSistema: true },
  { codigo: '2.4.08', nombre: 'INCES por enterar', esSistema: true },
  { codigo: '2.4.09', nombre: 'Retención ISLR salarios', esSistema: true },
  { codigo: '2.5', nombre: 'Anticipos de clientes', esSistema: true },

  // 3. PATRIMONIO
  { codigo: '3', nombre: 'PATRIMONIO', esSistema: true },
  { codigo: '3.1', nombre: 'Capital social', esSistema: true },
  { codigo: '3.2', nombre: 'Reserva legal', esSistema: true },
  { codigo: '3.3', nombre: 'Resultados acumulados', esSistema: true },
  { codigo: '3.4', nombre: 'Resultado del ejercicio', esSistema: true },
  { codigo: '3.5', nombre: 'Superávit/ajustes por reexpresión', esSistema: true },

  // 4. INGRESOS
  { codigo: '4', nombre: 'INGRESOS', esSistema: true },
  { codigo: '4.1', nombre: 'Ventas gravadas 16%', esSistema: true },
  { codigo: '4.2', nombre: 'Ventas gravadas 8%', esSistema: true },
  { codigo: '4.3', nombre: 'Ventas exentas/exoneradas', esSistema: true },
  { codigo: '4.4', nombre: 'Ventas de exportación', esSistema: true },
  { codigo: '4.5', nombre: 'Devoluciones y descuentos en ventas', esSistema: true },
  { codigo: '4.6', nombre: 'Otros ingresos', esSistema: true },
  { codigo: '4.7', nombre: 'Ganancia en diferencial cambiario', esSistema: true },

  // 5. COSTOS
  { codigo: '5', nombre: 'COSTOS', esSistema: true },
  { codigo: '5.1', nombre: 'Costo de ventas', esSistema: true },
  { codigo: '5.2', nombre: 'Compras', esSistema: true },

  // 6. GASTOS
  { codigo: '6', nombre: 'GASTOS', esSistema: true },
  { codigo: '6.1', nombre: 'Gastos de personal', esSistema: true },
  { codigo: '6.2', nombre: 'Servicios', esSistema: true },
  { codigo: '6.3', nombre: 'Gastos de venta', esSistema: true },
  { codigo: '6.4', nombre: 'Depreciación', esSistema: true },
  { codigo: '6.5', nombre: 'Tributos', esSistema: true },
  { codigo: '6.6', nombre: 'Gastos financieros y comisiones', esSistema: true },
  { codigo: '6.7', nombre: 'Pérdida en diferencial cambiario', esSistema: true },
  { codigo: '6.8', nombre: 'Gastos no deducibles', esSistema: true },
];

/** Cuenta de ganancia por diferencial cambiario / redondeo a favor (docs/03 §4.1.5, §4.2). */
export const CUENTA_GANANCIA_CAMBIARIA = '4.7';
/** Cuenta de pérdida por diferencial cambiario / redondeo en contra (docs/03 §4.1.5, §4.2). */
export const CUENTA_PERDIDA_CAMBIARIA = '6.7';

/** Plan de cuentas base ya construido y validado como árbol. */
export function planDeCuentasBase(): PlanDeCuentas {
  return PlanDeCuentas.desde(PLAN_DE_CUENTAS_BASE);
}
